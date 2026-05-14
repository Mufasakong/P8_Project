from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
import wave
from typing import Any

if os.name == "nt":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

import librosa
import numpy as np
import uvicorn
import websockets
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

try:
    from scipy.signal import butter, filtfilt, freqz
except Exception:  # pragma: no cover
    butter = None
    filtfilt = None

from prosody_core import (
    ProsodyConfig,
    analyze_audio_array,
    compute_mel_spectrogram,
    compute_stereo_features,
    downsample_spectrogram,
    float_audio_to_int16,
    load_audio_channels_16k,
)

PROSODY_WS = os.getenv("PROSODY_WS", "ws://localhost:8765")
DEBUG_BROWSER_HOST = os.getenv("DEBUG_BROWSER_HOST", "127.0.0.1")
DEBUG_BROWSER_PORT = int(os.getenv("DEBUG_BROWSER_PORT", "8000"))

BASE_DIR = os.path.dirname(__file__)
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")
STATIC_DIR = os.path.join(BASE_DIR, "static")

latest = None
clients = set()
audio_cache: dict[str, str | None] = {"processed": None, "original": None}


# =============================================================================
# App setup
# =============================================================================

def _ensure_runtime_dirs() -> None:
    os.makedirs(STATIC_DIR, exist_ok=True)
    os.makedirs(TEMPLATES_DIR, exist_ok=True)


def _template_response(name: str) -> FileResponse | HTMLResponse:
    path = os.path.join(TEMPLATES_DIR, name)
    if os.path.exists(path):
        return FileResponse(path)
    return HTMLResponse(f"Missing template: {name}. Expected at {path}.", status_code=503)


_ensure_runtime_dirs()
app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# =============================================================================
# Audio helpers
# =============================================================================

def _as_channels_first(y: np.ndarray) -> np.ndarray:
    y = np.asarray(y, dtype=np.float32)
    if y.ndim == 1:
        return y.reshape(1, -1)
    if y.ndim == 2:
        # librosa.load(mono=False) returns channels-first.
        return y
    raise ValueError(f"Unsupported audio shape: {y.shape}")


def _mixdown(ch: np.ndarray) -> np.ndarray:
    return np.mean(ch.astype(np.float32), axis=0)


def _select_channel(ch: np.ndarray, mode: str) -> np.ndarray:
    ch = _as_channels_first(ch)
    mode = (mode or "mixdown").lower()

    if ch.shape[0] == 1:
        return ch[0].astype(np.float32)

    left = ch[0].astype(np.float32)
    right = ch[1].astype(np.float32)
    n = min(left.size, right.size)
    left = left[:n]
    right = right[:n]

    if mode == "left":
        return left
    if mode == "right":
        return right
    if mode == "side":
        return 0.5 * (left - right)
    # mixdown and mid are identical for stereo.
    return 0.5 * (left + right)


def _butter_filter(y: np.ndarray, sr: int, *, low: float | None, high: float | None) -> np.ndarray:
    if y.size == 0:
        return y
    if butter is None or filtfilt is None:
        # Fallback: pre-emphasis is not equivalent, but avoids failing completely.
        if low is not None and high is None:
            return librosa.effects.preemphasis(y, coef=0.97).astype(np.float32)
        return y.astype(np.float32)

    nyq = 0.5 * float(sr)
    lo = None if low is None else float(low) / nyq
    hi = None if high is None else float(high) / nyq

    if lo is not None and lo <= 0:
        lo = None
    if hi is not None and hi >= 1:
        hi = 0.99

    if lo is None and hi is None:
        return y.astype(np.float32)

    if lo is not None and hi is not None:
        if hi <= lo:
            return y.astype(np.float32)
        btype = "bandpass"
        Wn = [lo, hi]
    elif lo is not None:
        btype = "highpass"
        Wn = lo
    else:
        btype = "lowpass"
        Wn = hi

    b, a = butter(4, Wn, btype=btype)
    return filtfilt(b, a, y).astype(np.float32)


def _noise_gate(y: np.ndarray) -> np.ndarray:
    if y.size == 0:
        return y
    stft = librosa.stft(y)
    mag = np.abs(stft)
    phase = stft / np.maximum(mag, 1e-9)
    noise_profile = np.median(mag, axis=1, keepdims=True)
    mask = mag >= (noise_profile * 1.5)
    mag_d = mag * mask
    return librosa.istft(mag_d * phase, length=y.shape[0]).astype(np.float32)


def apply_filters_mono(y: np.ndarray, sr: int, filters: list[str], filter_config: dict[str, Any] | None = None) -> np.ndarray:
    cfg = _filter_config_defaults(filter_config)
    out = np.asarray(y, dtype=np.float32)
    out = np.clip(out, -1.0, 1.0)

    if "noise" in filters:
        out = _noise_gate(out)
    if "highpass" in filters:
        out = _butter_filter(out, sr, low=cfg["highpass_hz"], high=None)
    if "lowpass" in filters:
        out = _butter_filter(out, sr, low=None, high=cfg["lowpass_hz"])
    if "bandpass" in filters:
        out = _butter_filter(out, sr, low=cfg["band_low_hz"], high=cfg["band_high_hz"])
    if "preemphasis" in filters:
        out = librosa.effects.preemphasis(out, coef=0.97).astype(np.float32)

    return np.clip(out, -1.0, 1.0).astype(np.float32)


def apply_filters_channels(ch: np.ndarray, sr: int, filters: list[str], filter_config: dict[str, Any] | None = None) -> np.ndarray:
    ch = _as_channels_first(ch)
    processed = np.vstack([apply_filters_mono(ch_i, sr, filters, filter_config) for ch_i in ch])

    if "normalize" in filters:
        rms = float(np.sqrt(np.mean(processed * processed) + 1e-12))
        target = 0.1
        processed = processed * (target / max(rms, 1e-6))

    return np.clip(processed, -1.0, 1.0).astype(np.float32)


def _write_wav(path: str, ch: np.ndarray, sr: int) -> None:
    ch = _as_channels_first(ch)
    # wave expects samples interleaved: L0,R0,L1,R1,...
    if ch.shape[0] == 1:
        interleaved = float_audio_to_int16(ch[0])
    else:
        interleaved = float_audio_to_int16(ch.T.reshape(-1))

    with wave.open(path, "wb") as wf:
        wf.setnchannels(int(ch.shape[0]))
        wf.setsampwidth(2)
        wf.setframerate(int(sr))
        wf.writeframes(interleaved.tobytes())


def _store_audio(variant: str, ch: np.ndarray, sr: int) -> str:
    prev = audio_cache.get(variant)
    if prev:
        try:
            os.unlink(prev)
        except Exception:
            pass
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    tmp.close()
    _write_wav(tmp.name, ch, sr)
    audio_cache[variant] = tmp.name
    return tmp.name


def compute_spectrum(y: np.ndarray, sr: int, max_points: int = 512) -> dict[str, Any]:
    y = np.asarray(y, dtype=np.float32)
    if y.size == 0:
        return {"freqHz": [], "db": []}

    n_fft = int(2 ** np.ceil(np.log2(min(max(y.size, 512), 16384))))
    x = y[:n_fft]
    if x.size < n_fft:
        x = np.pad(x, (0, n_fft - x.size))
    win = np.hanning(n_fft).astype(np.float32)
    mag = np.abs(np.fft.rfft(x * win))
    db = 20.0 * np.log10(mag + 1e-9)
    db = db - float(np.max(db))
    freq = np.fft.rfftfreq(n_fft, 1.0 / sr)

    if len(freq) > max_points:
        idx = np.linspace(0, len(freq) - 1, max_points).astype(int)
        freq = freq[idx]
        db = db[idx]

    return {"freqHz": [float(v) for v in freq], "db": [float(v) for v in db]}



def _filter_config_defaults(config: dict[str, Any] | None = None) -> dict[str, float]:
    cfg = {
        "highpass_hz": 80.0,
        "lowpass_hz": 4000.0,
        "band_low_hz": 80.0,
        "band_high_hz": 4000.0,
        "echo_delay_ms": 220.0,
        "echo_feedback": 0.35,
    }
    if isinstance(config, dict):
        for k in list(cfg.keys()):
            try:
                if k in config:
                    cfg[k] = float(config[k])
            except Exception:
                pass
    return cfg


def _parse_json_object(text: str | None) -> dict[str, Any]:
    if not text:
        return {}
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        return {}


def _parse_noise_experiment(text: str | None) -> dict[str, Any]:
    obj = _parse_json_object(text)
    enabled = bool(obj.get("enabled", False))
    try:
        snr_db = float(obj.get("snr_db", 10.0))
    except Exception:
        snr_db = 10.0
    try:
        seed = int(obj.get("seed", 42))
    except Exception:
        seed = 42
    kind = str(obj.get("type", "white")).lower()
    if kind not in {"white", "pinkish"}:
        kind = "white"
    return {"enabled": enabled, "snr_db": snr_db, "seed": seed, "type": kind}


def _add_noise_at_snr_channels(ch: np.ndarray, snr_db: float, seed: int = 42, kind: str = "white") -> np.ndarray:
    ch = _as_channels_first(ch).astype(np.float32)
    rng = np.random.default_rng(seed)
    out = np.zeros_like(ch, dtype=np.float32)
    for i in range(ch.shape[0]):
        x = ch[i]
        sig_power = float(np.mean(x * x) + 1e-12)
        noise = rng.standard_normal(x.shape[0]).astype(np.float32)
        if kind == "pinkish" and noise.size > 3:
            # A simple low-passed noise variant; not true pink noise, but useful for demos.
            noise = np.cumsum(noise).astype(np.float32)
            noise = noise - float(np.mean(noise))
        noise_power = float(np.mean(noise * noise) + 1e-12)
        target_noise_power = sig_power / (10.0 ** (float(snr_db) / 10.0))
        noise = noise * np.sqrt(target_noise_power / noise_power)
        out[i] = np.clip(x + noise, -1.0, 1.0)
    return out.astype(np.float32)


def _band_energy_ratios(y: np.ndarray, sr: int) -> dict[str, float]:
    y = np.asarray(y, dtype=np.float32)
    if y.size < 8:
        return {"lowEnergyRatio": 0.0, "speechEnergyRatio": 0.0, "highEnergyRatio": 0.0}
    n = int(2 ** np.ceil(np.log2(min(max(y.size, 512), 32768))))
    x = y[:n]
    if x.size < n:
        x = np.pad(x, (0, n-x.size))
    mag2 = np.abs(np.fft.rfft(x*np.hanning(n))) ** 2
    freqs = np.fft.rfftfreq(n, 1.0/sr)
    total = float(np.sum(mag2) + 1e-12)
    low = float(np.sum(mag2[freqs < 80.0]) / total)
    speech = float(np.sum(mag2[(freqs >= 80.0) & (freqs <= 4000.0)]) / total)
    high = float(np.sum(mag2[freqs > 4000.0]) / total)
    return {"lowEnergyRatio": low, "speechEnergyRatio": speech, "highEnergyRatio": high}


def summarize_signal_metrics(y: np.ndarray, sr: int) -> dict[str, float]:
    y = np.asarray(y, dtype=np.float32)
    if y.size == 0:
        return {}
    rms = float(np.sqrt(np.mean(y*y) + 1e-12))
    rms_db = float(20*np.log10(rms + 1e-12))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y, frame_length=512, hop_length=256))) if y.size > 512 else 0.0
    try:
        S = np.abs(librosa.stft(y, n_fft=512, hop_length=160, win_length=400))
        centroid = float(np.mean(librosa.feature.spectral_centroid(S=S, sr=sr)))
        rolloff = float(np.mean(librosa.feature.spectral_rolloff(S=S, sr=sr, roll_percent=0.85)))
        flatness = float(np.mean(librosa.feature.spectral_flatness(S=S)))
        flux = float(np.mean(np.sqrt(np.sum(np.diff(S, axis=1)**2, axis=0)))) if S.shape[1] > 1 else 0.0
    except Exception:
        centroid = rolloff = flatness = flux = 0.0
    ratios = _band_energy_ratios(y, sr)
    return {
        "rmsDb": rms_db,
        "rms": rms,
        "zcr": zcr,
        "spectralCentroidHz": centroid,
        "spectralRolloffHz": rolloff,
        "spectralFlatness": flatness,
        "spectralFlux": flux,
        **ratios,
    }


def metric_comparison(original: np.ndarray, processed: np.ndarray, sr: int) -> dict[str, Any]:
    a = summarize_signal_metrics(original, sr)
    b = summarize_signal_metrics(processed, sr)
    rows = []
    labels = {
        "rmsDb": "RMS energy (dB)",
        "lowEnergyRatio": "Low-band energy ratio (<80 Hz)",
        "speechEnergyRatio": "Speech-band energy ratio (80-4000 Hz)",
        "highEnergyRatio": "High-band energy ratio (>4000 Hz)",
        "spectralCentroidHz": "Spectral centroid (Hz)",
        "spectralRolloffHz": "Spectral rolloff (Hz)",
        "spectralFlatness": "Spectral flatness",
        "spectralFlux": "Spectral flux",
        "zcr": "Zero-crossing rate",
    }
    for k, label in labels.items():
        av = float(a.get(k, 0.0))
        bv = float(b.get(k, 0.0))
        rows.append({"key": k, "label": label, "original": av, "processed": bv, "change": bv-av})
    return {"original": a, "processed": b, "rows": rows}


def compute_filter_response(filters: list[str], sr: int, config: dict[str, float], max_points: int = 512) -> dict[str, Any]:
    cfg = _filter_config_defaults(config)
    n = 2048
    w = np.linspace(0, np.pi, n)
    h_total = np.ones(n, dtype=np.complex128)
    notes = []
    if butter is not None:
        nyq = 0.5 * sr
        def add_response(name, btype, Wn, note):
            nonlocal h_total
            try:
                b, a = butter(4, Wn, btype=btype)
                _, h = freqz(b, a, worN=w)
                h_total = h_total * h
                notes.append(note)
            except Exception:
                pass
        if "highpass" in filters:
            hp = max(5.0, min(cfg["highpass_hz"], nyq*0.95)) / nyq
            add_response("highpass", "highpass", hp, f"4th-order Butterworth high-pass, fc={cfg['highpass_hz']:.0f} Hz")
        if "lowpass" in filters:
            lp = max(5.0, min(cfg["lowpass_hz"], nyq*0.95)) / nyq
            add_response("lowpass", "lowpass", lp, f"4th-order Butterworth low-pass, fc={cfg['lowpass_hz']:.0f} Hz")
        if "bandpass" in filters:
            lo = max(5.0, min(cfg["band_low_hz"], nyq*0.90)) / nyq
            hi = max(lo+0.001, min(cfg["band_high_hz"], nyq*0.95)) / nyq
            add_response("bandpass", "bandpass", [lo, hi], f"4th-order Butterworth band-pass, {cfg['band_low_hz']:.0f}-{cfg['band_high_hz']:.0f} Hz")
    if "preemphasis" in filters:
        # H(z)=1-a z^-1, a=0.97
        a = 0.97
        h = 1.0 - a*np.exp(-1j*w)
        h_total = h_total * h
        notes.append("Pre-emphasis H(z)=1-0.97z^-1")
    if "noise" in filters:
        notes.append("Noise suppression is spectral gating, so it is signal-dependent and has no fixed linear response.")
    if "normalize" in filters:
        notes.append("RMS normalization changes gain, not spectral shape.")
    freq = (w / np.pi) * (sr/2)
    mag = 20*np.log10(np.maximum(np.abs(h_total), 1e-8))
    mag = np.clip(mag, -80, 20)
    if len(freq) > max_points:
        idx = np.linspace(0, len(freq)-1, max_points).astype(int)
        freq = freq[idx]; mag = mag[idx]
    return {"freqHz": [float(x) for x in freq], "db": [float(x) for x in mag], "notes": notes}


def channel_spectrum_comparison(ch: np.ndarray, sr: int) -> dict[str, Any]:
    ch = _as_channels_first(ch)
    if ch.shape[0] == 1:
        mono = ch[0]
        return {"mixdown": compute_spectrum(mono, sr), "left": compute_spectrum(mono, sr), "right": compute_spectrum(mono, sr), "mid": compute_spectrum(mono, sr), "side": compute_spectrum(np.zeros_like(mono), sr)}
    left = ch[0]
    right = ch[1]
    n = min(left.size, right.size)
    left, right = left[:n], right[:n]
    mid = 0.5*(left+right)
    side = 0.5*(left-right)
    return {
        "left": compute_spectrum(left, sr),
        "right": compute_spectrum(right, sr),
        "mixdown": compute_spectrum(mid, sr),
        "mid": compute_spectrum(mid, sr),
        "side": compute_spectrum(side, sr),
    }


def _add_mel(result: dict[str, Any], y: np.ndarray, cfg: ProsodyConfig) -> None:
    mel_db = compute_mel_spectrogram(
        y,
        cfg.sr,
        n_fft=cfg.n_fft,
        hop=cfg.hop,
        win=cfg.win,
        n_mels=cfg.mel_n_mels,
        fmin=cfg.mel_fmin,
        fmax=cfg.mel_fmax,
    )
    mel_ds, _ = downsample_spectrogram(mel_db, cfg.mel_max_frames)
    hop_sec = float(cfg.hop) / float(cfg.sr)
    if mel_db.shape[1] > 0 and mel_ds.shape[1] > 0:
        hop_sec = hop_sec * (float(mel_db.shape[1]) / float(mel_ds.shape[1]))
    result["melSpectrogram"] = mel_ds.tolist()
    result["melFrameHopSec"] = hop_sec


# =============================================================================
# Routes
# =============================================================================

@app.get("/")
def root():
    return _template_response("index.html")


@app.get("/legend")
def legend_page():
    return _template_response("legend.html")


@app.get("/clip_audio")
def clip_audio(variant: str = "processed"):
    path = audio_cache.get(variant)
    if not path or not os.path.exists(path):
        return HTMLResponse("No audio available", status_code=404)
    return FileResponse(path, media_type="audio/wav")


@app.websocket("/ws")
async def ws_clients(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        if latest is not None:
            await ws.send_text(json.dumps(latest))
        while True:
            await asyncio.sleep(10)
    except Exception:
        pass
    finally:
        clients.discard(ws)


@app.post("/analyze_clip")
async def analyze_clip(
    file: UploadFile = File(...),
    filters: str | None = Form(None),
    channel_mode: str | None = Form("mixdown"),
    filter_config: str | None = Form(None),
    noise_experiment: str | None = Form(None),
):
    start_time = time.perf_counter()
    data = await file.read()
    max_bytes = 100 * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")
    suffix = os.path.splitext(file.filename or "")[1].lower() or ".wav"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        cfg = ProsodyConfig()
        raw_ch = load_audio_channels_16k(tmp_path, sr=cfg.sr)
        raw_ch = _as_channels_first(raw_ch)

        filter_cfg = _filter_config_defaults(_parse_json_object(filter_config))
        noise_cfg = _parse_noise_experiment(noise_experiment)
        input_ch = raw_ch
        if noise_cfg.get("enabled"):
            input_ch = _add_noise_at_snr_channels(raw_ch, noise_cfg["snr_db"], noise_cfg["seed"], noise_cfg["type"])

        allowed_filters = {"noise", "highpass", "lowpass", "bandpass", "normalize", "preemphasis"}
        filter_list: list[str] = []
        if filters:
            try:
                parsed = json.loads(filters)
                if isinstance(parsed, list):
                    filter_list = [f for f in parsed if isinstance(f, str) and f in allowed_filters]
            except Exception:
                filter_list = []

        selected_mode = (channel_mode or "mixdown").lower()
        if selected_mode not in {"mixdown", "left", "right", "mid", "side"}:
            selected_mode = "mixdown"

        processed_ch = apply_filters_channels(input_ch, cfg.sr, filter_list, filter_cfg)

        # Store stereo/multichannel audio for playback. If the noise experiment is enabled,
        # "original" is the noisy input before filtering so before/after comparison is fair.
        _store_audio("original", input_ch, cfg.sr)
        _store_audio("processed", processed_ch, cfg.sr)

        y_raw_analysis = _select_channel(input_ch, selected_mode)
        y_processed_analysis = _select_channel(processed_ch, selected_mode)

        result: dict[str, Any] = analyze_audio_array(y_processed_analysis, config=cfg, include_features=True)
        _add_mel(result, y_processed_analysis, cfg)

        original = analyze_audio_array(y_raw_analysis, config=cfg, include_features=True)
        _add_mel(original, y_raw_analysis, cfg)
        result["original"] = original

        result["channelMode"] = selected_mode
        result["channelCount"] = int(raw_ch.shape[0])
        result["stereo"] = compute_stereo_features(input_ch, sr=cfg.sr)
        result["noiseExperiment"] = noise_cfg
        result["filterConfig"] = filter_cfg
        result["filterResponse"] = compute_filter_response(filter_list, cfg.sr, filter_cfg)
        result["metricComparison"] = metric_comparison(y_raw_analysis, y_processed_analysis, cfg.sr)
        result["channelSpectra"] = channel_spectrum_comparison(input_ch, cfg.sr)
        try:
            if "melSpectrogram" in result and "melSpectrogram" in original:
                _pm = np.asarray(result["melSpectrogram"], dtype=float)
                _om = np.asarray(original["melSpectrogram"], dtype=float)
                if _pm.shape == _om.shape:
                    result["melDifference"] = (_pm - _om).tolist()
        except Exception:
            pass
        result["spectra"] = {
            "original": compute_spectrum(y_raw_analysis, cfg.sr),
            "processed": compute_spectrum(y_processed_analysis, cfg.sr),
        }

        elapsed = time.perf_counter() - start_time
        audio_duration = float(raw_ch.shape[1] / cfg.sr) if raw_ch.shape[1] else 0.0
        speed_factor = float(audio_duration / elapsed) if elapsed > 0 else 0.0
        timing = {
            "processingTimeSec": float(elapsed),
            "audioDurationSec": audio_duration,
            "speedFactor": speed_factor,
            "sampleRate": int(cfg.sr),
            "channelCount": int(raw_ch.shape[0]),
            "channelMode": selected_mode,
        }
        result["timing"] = timing
        if "summary" not in result or not isinstance(result["summary"], dict):
            result["summary"] = {}
        result["summary"].update(timing)

        return result
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass



@app.post("/run_filter_experiment")
async def run_filter_experiment(
    file: UploadFile = File(...),
    channel_mode: str | None = Form("mixdown"),
    filter_config: str | None = Form(None),
    noise_experiment: str | None = Form(None),
    current_filters: str | None = Form(None),
):
    """
    Run a report-ready preprocessing experiment on the uploaded clip.
    """
    experiment_start = time.perf_counter()
    data = await file.read()
    max_bytes = 100 * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(status_code=413, detail="File too large (max 100MB)")
    suffix = os.path.splitext(file.filename or "")[1].lower() or ".wav"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        cfg = ProsodyConfig()
        raw_ch = load_audio_channels_16k(tmp_path, sr=cfg.sr)
        raw_ch = _as_channels_first(raw_ch)
        filter_cfg = _filter_config_defaults(_parse_json_object(filter_config))
        noise_cfg = _parse_noise_experiment(noise_experiment)
        input_ch = raw_ch
        input_label = "Raw input"
        if noise_cfg.get("enabled"):
            input_ch = _add_noise_at_snr_channels(raw_ch, noise_cfg["snr_db"], noise_cfg["seed"], noise_cfg["type"])
            input_label = f"Raw + {noise_cfg['snr_db']:.0f} dB white noise"

        selected_mode = (channel_mode or "mixdown").lower()
        if selected_mode not in {"mixdown", "left", "right", "mid", "side"}:
            selected_mode = "mixdown"

        allowed_filters = {"noise", "highpass", "lowpass", "bandpass", "normalize", "preemphasis"}
        parsed_current: list[str] = []
        try:
            parsed = json.loads(current_filters or "[]")
            if isinstance(parsed, list):
                parsed_current = [f for f in parsed if isinstance(f, str) and f in allowed_filters]
        except Exception:
            parsed_current = []

        conditions: list[dict[str, Any]] = [
            {"id": "raw", "label": input_label, "filters": []},
            {"id": "highpass", "label": f"High-pass {filter_cfg['highpass_hz']:.0f} Hz", "filters": ["highpass"]},
            {"id": "lowpass", "label": f"Low-pass {filter_cfg['lowpass_hz']:.0f} Hz", "filters": ["lowpass"]},
            {"id": "bandpass", "label": f"Band-pass {filter_cfg['band_low_hz']:.0f}-{filter_cfg['band_high_hz']:.0f} Hz", "filters": ["bandpass"]},
            {"id": "noise", "label": "Spectral noise suppression", "filters": ["noise"]},
            {"id": "normalize", "label": "RMS normalization", "filters": ["normalize"]},
            {"id": "preemphasis", "label": "Pre-emphasis", "filters": ["preemphasis"]},
        ]
        if parsed_current:
            current_set = tuple(parsed_current)
            if not any(tuple(c["filters"]) == current_set for c in conditions):
                conditions.append({"id": "current", "label": "Current selected filters", "filters": parsed_current})

        raw_y = _select_channel(input_ch, selected_mode)
        raw_metrics = summarize_signal_metrics(raw_y, cfg.sr)
        rows: list[dict[str, Any]] = []

        for cond in conditions:
            cond_start = time.perf_counter()
            cond_filters = list(cond["filters"])
            processed_ch = apply_filters_channels(input_ch, cfg.sr, cond_filters, filter_cfg) if cond_filters else input_ch
            y = _select_channel(processed_ch, selected_mode)
            metrics = summarize_signal_metrics(y, cfg.sr)
            try:
                prosody = analyze_audio_array(y, config=cfg, include_features=False).get("summary", {})
            except Exception:
                prosody = {}
            elapsed = time.perf_counter() - cond_start
            duration_sec = float(input_ch.shape[1] / cfg.sr) if input_ch.shape[1] else 0.0
            speed_factor = float(duration_sec / elapsed) if elapsed > 0 else 0.0
            rows.append({
                "id": cond["id"],
                "condition": cond["label"],
                "filters": cond_filters,
                "rmsDb": float(metrics.get("rmsDb", 0.0)),
                "rmsDbChange": float(metrics.get("rmsDb", 0.0) - raw_metrics.get("rmsDb", 0.0)),
                "spectralCentroidHz": float(metrics.get("spectralCentroidHz", 0.0)),
                "spectralCentroidChangeHz": float(metrics.get("spectralCentroidHz", 0.0) - raw_metrics.get("spectralCentroidHz", 0.0)),
                "spectralRolloffHz": float(metrics.get("spectralRolloffHz", 0.0)),
                "spectralFlatness": float(metrics.get("spectralFlatness", 0.0)),
                "spectralFlux": float(metrics.get("spectralFlux", 0.0)),
                "zcr": float(metrics.get("zcr", 0.0)),
                "lowEnergyRatio": float(metrics.get("lowEnergyRatio", 0.0)),
                "speechEnergyRatio": float(metrics.get("speechEnergyRatio", 0.0)),
                "highEnergyRatio": float(metrics.get("highEnergyRatio", 0.0)),
                "meanSpeechConfidence": float(prosody.get("meanSpeechConfidence", 0.0)),
                "meanBoundaryConfidence": float(prosody.get("meanBoundaryConfidence", 0.0)),
                "voicedFrameRatio": float(prosody.get("voicedFrameRatio", 0.0)),
                "speechLikeRatio": float(prosody.get("speechLikeRatio", 0.0)),
                "processingTimeSec": float(elapsed),
                "speedFactor": float(speed_factor),
            })

        total_elapsed = time.perf_counter() - experiment_start
        return {
            "type": "filter_experiment",
            "filename": file.filename or "audio",
            "sampleRate": int(cfg.sr),
            "channelCount": int(raw_ch.shape[0]),
            "channelMode": selected_mode,
            "audioDurationSec": float(raw_ch.shape[1] / cfg.sr) if raw_ch.shape[1] else 0.0,
            "totalProcessingTimeSec": float(total_elapsed),
            "filterConfig": filter_cfg,
            "noiseExperiment": noise_cfg,
            "stereo": compute_stereo_features(input_ch, sr=cfg.sr),
            "rows": rows,
        }
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
async def prosody_listener():
    global latest
    while True:
        try:
            async with websockets.connect(PROSODY_WS, max_size=2**23, ping_interval=None, ping_timeout=None) as ws:
                await ws.send("monitor")
                while True:
                    msg = await ws.recv()
                    if isinstance(msg, bytes):
                        continue
                    d = json.loads(msg)
                    if d.get("type") != "prosody_features":
                        continue
                    latest = d
                    payload = json.dumps(d)
                    dead = []
                    for c in list(clients):
                        try:
                            await c.send_text(payload)
                        except Exception:
                            dead.append(c)
                    for c in dead:
                        clients.discard(c)
        except Exception:
            await asyncio.sleep(1)


@app.on_event("startup")
async def _startup():
    asyncio.create_task(prosody_listener())


if __name__ == "__main__":
    uvicorn.run(app, host=DEBUG_BROWSER_HOST, port=DEBUG_BROWSER_PORT, log_level="info")

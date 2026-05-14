from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import websockets

from prosody_core import (
    ProsodyConfig,
    compute_stereo_features,
    init_prosody_state,
    update_prosody_frame,
)

HOST = os.getenv("PROSODY_HOST", "0.0.0.0")
PORT = int(os.getenv("PROSODY_PORT", "8765"))
CHANNELS = int(os.getenv("PROSODY_CHANNELS", "1"))  # 1 = mono, 2 = interleaved stereo PCM16

config = ProsodyConfig(
    sr=16000,
    frame_ms=int(os.getenv("PROSODY_FRAME_MS", "20")),
    feature_hz=int(os.getenv("PROSODY_FEATURE_HZ", "10")),
    win_sec=float(os.getenv("PROSODY_WIN_SEC", "1.0")),
    n_fft=int(os.getenv("PROSODY_NFFT", "512")),
    hop=int(os.getenv("PROSODY_HOP", "160")),
    win=int(os.getenv("PROSODY_WIN", "400")),
    slope_sec=float(os.getenv("PROSODY_SLOPE_SEC", "0.5")),
    noise_ema_alpha=float(os.getenv("PROSODY_NOISE_ALPHA", "0.95")),
    snr_on=float(os.getenv("PROSODY_SNR_ON", "2.5")),
    snr_off=float(os.getenv("PROSODY_SNR_OFF", "1.8")),
    hangover_sec=float(os.getenv("PROSODY_HANGOVER_SEC", "0.20")),
    smooth_alpha=float(os.getenv("PROSODY_SMOOTH_ALPHA", "0.80")),
    w_snr=float(os.getenv("PROSODY_W_SNR", "0.6")),
    w_speech_band=float(os.getenv("PROSODY_W_SPEECH_BAND", "1.0")),
    w_low_rumble=float(os.getenv("PROSODY_W_LOW_RUMBLE", "1.0")),
    w_flatness=float(os.getenv("PROSODY_W_FLATNESS", "1.0")),
    speech_conf_thr=float(os.getenv("PROSODY_SPEECHCONF_THR", "0.0")),
    mel_n_mels=int(os.getenv("PROSODY_MEL_N_MELS", "64")),
    mel_fmin=float(os.getenv("PROSODY_MEL_FMIN", "50.0")),
    mel_fmax=float(os.getenv("PROSODY_MEL_FMAX", "0")) or None,
    emit_mel_frame=os.getenv("PROSODY_EMIT_MEL_FRAME", "1") == "1",
    mel_max_frames=int(os.getenv("PROSODY_MEL_MAX_FRAMES", "700")),
)

SUBSCRIBERS: set[Any] = set()


@dataclass
class MonoRuntime:
    ring: np.ndarray
    ring_write: int
    ring_filled: int
    state: Any


def make_runtime() -> MonoRuntime:
    return MonoRuntime(
        ring=np.zeros(config.win_samples, dtype=np.int16),
        ring_write=0,
        ring_filled=0,
        state=init_prosody_state(),
    )


def channel_names(n: int) -> list[str]:
    if n == 1:
        return ["mono"]
    if n == 2:
        return ["left", "right"]
    return [f"ch{i}" for i in range(n)]


async def broadcast(out: dict[str, Any]) -> None:
    if not SUBSCRIBERS:
        return

    payload = json.dumps(out)
    dead = []

    for sub in list(SUBSCRIBERS):
        try:
            await sub.send(payload)
        except Exception:
            dead.append(sub)

    for sub in dead:
        SUBSCRIBERS.discard(sub)


def decode_pcm16_frame(frame_bytes: bytes, channels: int) -> np.ndarray:
    """
    Decode one interleaved PCM16 frame into channels-first int16.

    Return shape: (channels, samples_per_channel).
    """
    x = np.frombuffer(frame_bytes, dtype=np.int16)

    if channels <= 1:
        return x.reshape(1, -1)

    usable = (x.size // channels) * channels
    x = x[:usable]
    if x.size == 0:
        return np.zeros((channels, 0), dtype=np.int16)

    return x.reshape(-1, channels).T.copy()


def mixdown_int16(channels_first: np.ndarray) -> np.ndarray:
    if channels_first.shape[0] == 1:
        return channels_first[0]
    mix = np.mean(channels_first.astype(np.float32), axis=0)
    return np.clip(mix, -32768, 32767).astype(np.int16)


def run_mono_runtime(runtime: MonoRuntime, frame: np.ndarray, now: float) -> dict[str, Any] | None:
    runtime.ring_write, runtime.ring_filled, out = update_prosody_frame(
        frame,
        runtime.ring,
        runtime.ring_write,
        runtime.ring_filled,
        runtime.state,
        now,
        config=config,
    )
    return out


async def handler(ws):
    channels = max(1, CHANNELS)
    names = channel_names(channels)

    mix_runtime = make_runtime()
    channel_runtimes = [make_runtime() for _ in range(channels)]

    buf = bytearray()
    last_out = time.time()

    bytes_per_sample = 2
    frame_bytes_needed = config.frame_samples * bytes_per_sample * channels

    await ws.send(
        json.dumps(
            {
                "type": "hello",
                "sr": config.sr,
                "frame_ms": config.frame_ms,
                "channels": channels,
                "pcm_format": "int16_interleaved" if channels > 1 else "int16_mono",
            }
        )
    )

    try:
        async for msg in ws:
            if isinstance(msg, str):
                if msg.strip().lower() == "monitor":
                    SUBSCRIBERS.add(ws)
                    await ws.send(json.dumps({"type": "monitor_ok"}))
                continue

            buf.extend(msg)

            while len(buf) >= frame_bytes_needed:
                frame_bytes = bytes(buf[:frame_bytes_needed])
                del buf[:frame_bytes_needed]

                ch_frame = decode_pcm16_frame(frame_bytes, channels)
                now = time.time()

                per_channel_out = []
                for i in range(channels):
                    ch_out = run_mono_runtime(channel_runtimes[i], ch_frame[i], now)
                    if ch_out is not None:
                        ch_out = dict(ch_out)
                        ch_out["channelIndex"] = i
                        ch_out["channelName"] = names[i]
                        per_channel_out.append(ch_out)

                mix_frame = mixdown_int16(ch_frame)
                mix_out = run_mono_runtime(mix_runtime, mix_frame, now)

                if (now - last_out) >= config.out_interval and mix_out is not None:
                    last_out = now
                    out = dict(mix_out)
                    out["analysisMode"] = "mixdown" if channels > 1 else "mono"
                    out["channelCount"] = channels
                    out["channelNames"] = names

                    if channels > 1:
                        float_ch = ch_frame.astype(np.float32) / 32768.0
                        out["stereo"] = compute_stereo_features(float_ch, sr=config.sr)
                        out["channels"] = per_channel_out

                    await ws.send(json.dumps(out))
                    await broadcast(out)

    finally:
        SUBSCRIBERS.discard(ws)


async def main():
    async with websockets.serve(handler, HOST, PORT, max_size=2**23):
        print(f"Prosody server on ws://{HOST}:{PORT}")
        print(f"Audio format: {CHANNELS} channel(s), PCM16, 16 kHz")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())

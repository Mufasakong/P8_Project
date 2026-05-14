function collectSelectedFilters() {
  const filters = [];
  document.querySelectorAll('#filterList input[type="checkbox"]').forEach(cb => {
    if (cb.checked && cb.dataset.analysisFilter === "1") filters.push(cb.dataset.filter);
  });
  return filters;
}

function collectSelectedPlaybackFilters() {
  const filters = [];
  document.querySelectorAll('#filterList input[type="checkbox"]').forEach(cb => {
    if (cb.checked && cb.dataset.playbackFilter === "1") filters.push(cb.dataset.filter);
  });
  return filters;
}

function collectChannelMode() {
  const sel = document.getElementById("channelModeSelect");
  return sel ? sel.value : "mixdown";
}

function sliderNumber(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = Number(el.value);
  return isFinite(v) ? v : fallback;
}

function collectFilterConfig() {
  return {
    highpass_hz: sliderNumber("highpassHz", 80),
    lowpass_hz: sliderNumber("lowpassHz", 4000),
    band_low_hz: sliderNumber("bandLowHz", 80),
    band_high_hz: sliderNumber("bandHighHz", 4000),
    echo_delay_ms: sliderNumber("echoDelayMs", 220),
    echo_feedback: sliderNumber("echoFeedback", 0.35),
  };
}

function collectNoiseExperiment() {
  const enabled = document.getElementById("noiseExperimentEnabled")?.checked || false;
  return {
    enabled,
    snr_db: sliderNumber("noiseSnrDb", 10),
    seed: 42,
    type: "white",
  };
}

function updateFilterParamLabels() {
  const cfg = collectFilterConfig();
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("highpassValue", `${Math.round(cfg.highpass_hz)} Hz`);
  set("lowpassValue", `${Math.round(cfg.lowpass_hz)} Hz`);
  set("bandLowValue", `${Math.round(cfg.band_low_hz)} Hz`);
  set("bandHighValue", `${Math.round(cfg.band_high_hz)} Hz`);
  set("echoDelayValue", `${Math.round(cfg.echo_delay_ms)} ms`);
  set("echoFeedbackValue", `${cfg.echo_feedback.toFixed(2)}`);
  set("noiseSnrValue", `${Math.round(sliderNumber("noiseSnrDb", 10))} dB`);
}

function summarizeFilters(filters) {
  if (!filters.length) return "Raw";
  const labels = {
    noise: "Noise suppression",
    highpass: "High-pass (80 Hz)",
    lowpass: "Low-pass (4 kHz)",
    bandpass: "Band-pass (80-4000 Hz)",
    normalize: "Normalize RMS",
    preemphasis: "Pre-emphasis",
    echo: "Echo (playback only)",
  };
  return filters.map(f => labels[f] || f).join(", ");
}

function formatDb(v) {
  return (typeof v === "number" && isFinite(v)) ? `${v.toFixed(2)} dB` : "-";
}

function formatNum(v, digits = 2) {
  return (typeof v === "number" && isFinite(v)) ? v.toFixed(digits) : "-";
}

function stereoHint(stereo, channelMode) {
  if (!stereo || !stereo.channelCount) return "Upload and process a clip to inspect stereo information.";
  if (stereo.channelCount < 2) return "This file is mono. Left/right/mid/side will not produce meaningful differences.";
  const corr = stereo.leftRightCorrelation;
  const width = stereo.stereoWidth;
  if (typeof corr === "number" && corr > 0.98 && typeof width === "number" && width < 0.03) {
    return "The channels are almost identical. This is likely dual-mono, so left/right/mixdown will look very similar.";
  }
  if (channelMode === "side" && typeof width === "number" && width < 0.05) {
    return "Side mode is mostly the difference between L and R; this clip has very little side energy.";
  }
  return "True stereo differences are present when correlation is below 1.00 or stereo width is clearly above 0.";
}

function renderStereoDiagnostics(stereo, channelMode = "mixdown") {
  const grid = state.stereoDiagnosticsGrid || document.getElementById("stereoDiagnosticsGrid");
  const hint = state.stereoDiagnosticsHint || document.getElementById("stereoDiagnosticsHint");
  if (!grid) return;

  const rows = [
    ["Detected channels", stereo && stereo.channelCount !== undefined ? String(stereo.channelCount) : "-"],
    ["Analysis channel", channelMode || "mixdown"],
    ["Left RMS dB", stereo ? formatDb(stereo.leftRmsDb ?? (stereo.channelRmsDb ? stereo.channelRmsDb[0] : undefined)) : "-"],
    ["Right RMS dB", stereo ? formatDb(stereo.rightRmsDb ?? (stereo.channelRmsDb ? stereo.channelRmsDb[1] : undefined)) : "-"],
    ["Balance L-R", stereo ? formatDb(stereo.balanceDbLeftMinusRight) : "-"],
    ["L/R correlation", stereo ? formatNum(stereo.leftRightCorrelation, 3) : "-"],
    ["Mid RMS dB", stereo ? formatDb(stereo.midRmsDb) : "-"],
    ["Side RMS dB", stereo ? formatDb(stereo.sideRmsDb) : "-"],
    ["Stereo width", stereo ? formatNum(stereo.stereoWidth, 3) : "-"],
  ];

  grid.innerHTML = "";
  rows.forEach(([key, val]) => {
    const row = document.createElement("div");
    row.className = "kv";
    row.innerHTML = `<span class="k">${key}</span><span class="v">${val}</span>`;
    grid.appendChild(row);
  });
  if (hint) hint.textContent = stereoHint(stereo, channelMode);
}

function computeBaselineFromFeatures(features) {
  if (!features || !features.length) return null;
  const stats = {};
  ALL_SIGNALS.forEach(sig => {
    const vals = features
      .map(f => f[sig.key])
      .filter(v => typeof v === "number" && isFinite(v));
    if (!vals.length) return;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const varSum = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
    const std = Math.sqrt(varSum + 1e-9);
    stats[sig.key] = { mean, std };
  });
  return stats;
}

function applyBaselineTransform(key, value) {
  const baselineNormalize = state.baselineNormalize;
  if (!baselineNormalize || !baselineNormalize.checked) return value;
  if (!state.baselineStats || !state.baselineStats[key]) return value;
  const { mean, std } = state.baselineStats[key];
  if (!isFinite(mean) || !isFinite(std) || std <= 0) return value;
  return (value - mean) / std;
}

function scaleValue(key, raw, scale) {
  if (raw === undefined || raw === null) return null;
  const normalized = applyBaselineTransform(key, raw);
  const baselineNormalize = state.baselineNormalize;
  if (baselineNormalize && baselineNormalize.checked) return normalized;
  return normalized * scale;
}

function renderBoundaryList(boundaries) {
  const box = document.getElementById("boundaryList");
  if (!boundaries || !boundaries.length) {
    box.innerHTML = "None";
    return;
  }
  box.innerHTML = boundaries
    .map(b => `t=${b.t.toFixed(2)}s, conf=${b.confidence.toFixed(2)}`)
    .join("<br/>");
}

function findNearestPoint(t, arr) {
  if (!arr.length) return null;
  let best = arr[0];
  let bestDiff = Math.abs((best.t || 0) - t);

  for (let i = 1; i < arr.length; i++) {
    const diff = Math.abs((arr[i].t || 0) - t);
    if (diff < bestDiff) {
      best = arr[i];
      bestDiff = diff;
    }
  }
  return best;
}

function findCurrentSegment(t, segments) {
  for (const s of segments) {
    if (t >= s.start && t <= s.end) return s;
  }
  return null;
}

function visibleClipWindow(t) {
  const half = state.clipWindowSec / 2;
  let start = Math.max(0, t - half);
  let end = Math.min(state.clipDuration, t + half);

  if ((end - start) < state.clipWindowSec) {
    if (start <= 0) {
      end = Math.min(state.clipDuration, state.clipWindowSec);
    } else if (end >= state.clipDuration) {
      start = Math.max(0, state.clipDuration - state.clipWindowSec);
    }
  }

  return { start, end };
}

// -----------------------------------------------------------------------------
// Spectrum rendering
// -----------------------------------------------------------------------------

function drawSpectrumCanvas(canvas, spectrum, title) {
  if (!canvas || !spectrum || !Array.isArray(spectrum.freqHz) || !Array.isArray(spectrum.db)) return;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  resizeCanvasToDisplaySize(canvas, ratio);
  const w = canvas.width;
  const h = canvas.height;
  const padL = 40 * ratio;
  const padR = 10 * ratio;
  const padT = 14 * ratio;
  const padB = 26 * ratio;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = document.body.dataset.theme === "dark" ? "#050505" : "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const freqs = spectrum.freqHz;
  const db = spectrum.db;
  if (!freqs.length || !db.length) return;

  const fMax = Math.max(...freqs, 1);
  const minDb = -80;
  const maxDb = 0;

  ctx.strokeStyle = document.body.dataset.theme === "dark" ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.16)";
  ctx.lineWidth = 1;
  ctx.font = `${11 * ratio}px Manrope, sans-serif`;
  ctx.fillStyle = document.body.dataset.theme === "dark" ? "#d8d8d8" : "#222";

  // Grid and labels
  [0, 1000, 2000, 4000, 8000].forEach(f => {
    if (f > fMax) return;
    const x = padL + (f / fMax) * (w - padL - padR);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, h - padB);
    ctx.stroke();
    ctx.fillText(`${f/1000}k`, x + 2 * ratio, h - 8 * ratio);
  });
  [-80, -60, -40, -20, 0].forEach(v => {
    const y = padT + (1 - (v - minDb) / (maxDb - minDb)) * (h - padT - padB);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(`${v}`, 4 * ratio, y + 4 * ratio);
  });

  ctx.strokeStyle = document.body.dataset.theme === "dark" ? "#f2f2f2" : "#111";
  ctx.lineWidth = 2 * ratio;
  ctx.beginPath();
  for (let i = 0; i < freqs.length; i++) {
    const x = padL + (freqs[i] / fMax) * (w - padL - padR);
    const y = padT + (1 - clamp((db[i] - minDb) / (maxDb - minDb), 0, 1)) * (h - padT - padB);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (title) {
    ctx.fillStyle = document.body.dataset.theme === "dark" ? "#f2f2f2" : "#111";
    ctx.fillText(title, padL, 12 * ratio);
  }
}

function renderSpectrumComparison() {
  if (!state.spectra) return;
  drawSpectrumCanvas(state.spectrumOriginal, state.spectra.original, "Original spectrum");
  drawSpectrumCanvas(state.spectrumProcessed, state.spectra.processed, "Processed spectrum");
  if (state.filterResponse && state.filterResponseCanvas) {
    drawSpectrumCanvas(state.filterResponseCanvas, state.filterResponse, "|H(f)| response");
  }
  if (state.filterResponseNotes) {
    const notes = state.filterResponse && Array.isArray(state.filterResponse.notes) ? state.filterResponse.notes : [];
    state.filterResponseNotes.innerHTML = notes.length ? notes.map(n => `• ${n}`).join("<br/>") : "No linear filter selected.";
  }
  renderChannelSpectra();
  renderMetricComparison();
  renderDiffSpectrogram();
  renderSpectrumMeta();
}

function renderSpectrumMeta() {
  if (!state.spectrumMeta) return;
  const filters = summarizeFilters(collectSelectedFilters());
  const noise = collectNoiseExperiment();
  const noiseText = noise.enabled ? `Synthetic noise: ${noise.snr_db} dB SNR. ` : "";
  state.spectrumMeta.textContent = `Channel: ${state.lastChannelMode || collectChannelMode()}. Analysis filters: ${filters}. ${noiseText}FFT magnitude spectrum and response show what frequencies are removed or preserved.`;
}

function renderMetricComparison() {
  const table = state.metricComparisonTable;
  const mc = state.metricComparison;
  if (!table) return;
  if (!mc || !Array.isArray(mc.rows)) {
    table.innerHTML = "<tr><td>Process a clip to show metrics.</td></tr>";
    return;
  }
  function fmt(v, key) {
    if (typeof v !== "number" || !isFinite(v)) return "-";
    if (key && key.toLowerCase().includes("hz")) return v.toFixed(1);
    if (Math.abs(v) >= 100) return v.toFixed(1);
    return v.toFixed(4);
  }
  table.innerHTML = `<thead><tr><th>Metric</th><th>Original</th><th>Processed</th><th>Change</th></tr></thead>` +
    `<tbody>` + mc.rows.map(r => `<tr><td>${r.label}</td><td>${fmt(r.original, r.key)}</td><td>${fmt(r.processed, r.key)}</td><td>${fmt(r.change, r.key)}</td></tr>`).join("") + `</tbody>`;
}

function renderDiffSpectrogram() {
  if (!state.diffSpectrogram || !state.melDifference) return;
  renderSpectrogramCanvas(state.diffSpectrogram.getContext("2d"), state.melDifference, 0, null, true);
}

function renderChannelSpectra() {
  const cs = state.channelSpectra;
  if (!cs) return;
  drawSpectrumCanvas(state.channelSpectrumLeft, cs.left, "Left");
  drawSpectrumCanvas(state.channelSpectrumRight, cs.right, "Right");
  drawSpectrumCanvas(state.channelSpectrumMid, cs.mid || cs.mixdown, "Mid");
  drawSpectrumCanvas(state.channelSpectrumSide, cs.side, "Side");
}

function downloadTextFile(filename, text, mime="text/plain") {
  const blob = new Blob([text], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

function exportCurrentJson() {
  if (!state.lastResult) { alert("Process a clip first."); return; }
  downloadTextFile("prosody_analysis.json", JSON.stringify(state.lastResult, null, 2), "application/json");
}

function exportCurrentFeaturesCsv() {
  const rows = state.clipFeatures || [];
  if (!rows.length) { alert("Process a clip first."); return; }
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const csv = [keys.join(",")].concat(rows.map(r => keys.map(k => esc(r[k])).join(","))).join("\n");
  downloadTextFile("prosody_features.csv", csv, "text/csv");
}

// -----------------------------------------------------------------------------
// Browser-side live playback filtering
// -----------------------------------------------------------------------------

function getPlaybackContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!state.playbackCtx) state.playbackCtx = new AudioCtx();
  return state.playbackCtx;
}

async function resumePlaybackContext() {
  const ctx = getPlaybackContext();
  if (ctx && ctx.state === "suspended") {
    try { await ctx.resume(); } catch {}
  }
}

async function decodeAudioArrayBuffer(arrayBuffer) {
  const ctx = getPlaybackContext();
  if (!ctx) return null;
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    console.warn("Could not decode audio for waveform:", err);
    return null;
  }
}

async function decodeUploadedAudioForWaveform(file) {
  const arr = await file.arrayBuffer();
  const decoded = await decodeAudioArrayBuffer(arr);
  state.rawAudioBuffer = decoded;
  state.originalAudioBuffer = decoded;
  state.processedAudioBuffer = null;
}

async function decodeServerClipForWaveform(variant) {
  try {
    const res = await fetch(`/clip_audio?variant=${variant}&cacheBust=${Date.now()}`);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    const decoded = await decodeAudioArrayBuffer(arr);
    if (variant === "processed") state.processedAudioBuffer = decoded;
    if (variant === "original") state.originalAudioBuffer = decoded;
    return decoded;
  } catch (err) {
    console.warn("Could not decode server clip:", err);
    return null;
  }
}

function isPlaybackFilterChecked(name) {
  const cb = document.querySelector(`#filterList input[data-filter="${name}"]`);
  return !!cb && cb.checked && cb.dataset.playbackFilter === "1";
}

function setupPlaybackGraph() {
  const player = document.getElementById("player");
  if (!player) return;
  const ctx = getPlaybackContext();
  if (!ctx) return;

  if (!state.playbackSource) {
    try {
      state.playbackSource = ctx.createMediaElementSource(player);
    } catch (err) {
      // createMediaElementSource can only be created once per media element.
      // If a browser throws here after hot reload, keep existing playback path.
      console.warn("Playback graph source could not be created:", err);
      return;
    }
  }

  rebuildPlaybackGraph();
}

function disconnectPlaybackNodes() {
  try {
    if (state.playbackSource) state.playbackSource.disconnect();
  } catch {}

  if (state.playbackNodes) {
    state.playbackNodes.forEach(n => {
      try { n.disconnect(); } catch {}
    });
  }

  state.playbackNodes = [];
}

function rebuildPlaybackGraph() {
  const ctx = state.playbackCtx;
  if (!ctx || !state.playbackSource) return;

  disconnectPlaybackNodes();

  let node = state.playbackSource;

  // Classical signal-processing playback filters.
  if (isPlaybackFilterChecked("highpass")) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = collectFilterConfig().highpass_hz;
    hp.Q.value = 0.707;
    node.connect(hp);
    node = hp;
    state.playbackNodes.push(hp);
  }

  if (isPlaybackFilterChecked("lowpass")) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = collectFilterConfig().lowpass_hz;
    lp.Q.value = 0.707;
    node.connect(lp);
    node = lp;
    state.playbackNodes.push(lp);
  }

  if (isPlaybackFilterChecked("bandpass")) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    const cfg = collectFilterConfig();
    const lo = Math.max(20, cfg.band_low_hz);
    const hi = Math.max(lo + 50, cfg.band_high_hz);
    bp.frequency.value = Math.sqrt(lo * hi);
    bp.Q.value = Math.max(0.1, bp.frequency.value / (hi - lo));
    node.connect(bp);
    node = bp;
    state.playbackNodes.push(bp);
  }

  // Echo is kept as a playback-only demonstration effect.
  // It is not sent to Python for the serious analysis pipeline.
  if (isPlaybackFilterChecked("echo")) {
    const dry = ctx.createGain();
    dry.gain.value = 0.85;

    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = collectFilterConfig().echo_delay_ms / 1000.0;

    const feedback = ctx.createGain();
    feedback.gain.value = collectFilterConfig().echo_feedback;

    const wet = ctx.createGain();
    wet.gain.value = 0.35;

    node.connect(dry);
    dry.connect(ctx.destination);

    node.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(ctx.destination);

    state.playbackNodes.push(dry, delay, feedback, wet);
    state.playbackGraphReady = true;
    return;
  }

  node.connect(ctx.destination);
  state.playbackGraphReady = true;
}

function initPlaybackFilterClicks() {
  updateFilterParamLabels();
  document.querySelectorAll('#filterList input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      setupPlaybackGraph();
      rebuildPlaybackGraph();
      const player = document.getElementById("player");
      if (state.currentMode === "clip") {
        renderClipAtTime(player ? player.currentTime : 0);
        renderSpectrumComparison();
      }
    });
  });
  ["highpassHz","lowpassHz","bandLowHz","bandHighHz","echoDelayMs","echoFeedback","noiseSnrDb"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      updateFilterParamLabels();
      rebuildPlaybackGraph();
      if (state.currentMode === "clip") renderSpectrumComparison();
    });
  });
  const noiseToggle = document.getElementById("noiseExperimentEnabled");
  if (noiseToggle) noiseToggle.addEventListener("change", () => {
    if (state.uploadStatusEl) state.uploadStatusEl.textContent = "Noise experiment changed. Press Process clip to recompute analysis.";
  });
  const exportJsonBtn = document.getElementById("exportJsonBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");
  if (exportJsonBtn) exportJsonBtn.addEventListener("click", exportCurrentJson);
  if (exportCsvBtn) exportCsvBtn.addEventListener("click", exportCurrentFeaturesCsv);
}

function activeWaveformBuffer() {
  if (state.activeClipVariant === "original") {
    return state.originalAudioBuffer || state.rawAudioBuffer || state.processedAudioBuffer;
  }
  return state.processedAudioBuffer || state.rawAudioBuffer || state.originalAudioBuffer;
}

function waveformMode() {
  const sel = state.waveformModeSelect || document.getElementById("waveformModeSelect");
  return sel ? sel.value : "analysis";
}

function sampleForMode(channels, sampleIndex, mode) {
  if (!channels.length) return 0;
  const left = channels[0][sampleIndex] || 0;
  const right = channels.length > 1 ? (channels[1][sampleIndex] || 0) : left;
  if (mode === "left") return left;
  if (mode === "right") return right;
  if (mode === "side") return 0.5 * (left - right);
  return 0.5 * (left + right);
}

function resolvedWaveformMode() {
  const mode = waveformMode();
  if (mode === "analysis") return state.lastChannelMode || collectChannelMode();
  return mode;
}

function drawOneWaveformTrace(ctx, channels, startSample, endSample, samplesPerPixel, mid, amp, mode, color, lineWidth) {
  const w = ctx.canvas.width;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  for (let x = 0; x < w; x++) {
    const s0 = startSample + x * samplesPerPixel;
    const s1 = Math.min(endSample, s0 + samplesPerPixel);

    let min = 1.0;
    let max = -1.0;

    for (let s = s0; s < s1; s++) {
      const v = sampleForMode(channels, s, mode);
      if (v < min) min = v;
      if (v > max) max = v;
    }

    const y1 = mid - max * amp;
    const y2 = mid - min * amp;

    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
  }
}

function drawAudioBufferWaveform(buffer, centerTime, windowSec) {
  const ctx = state.clipWaveformCtx;
  if (!ctx || !buffer) return;

  const ratio = window.devicePixelRatio || 1;
  resizeCanvasToDisplaySize(ctx.canvas, ratio);

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const mid = h / 2;
  const amp = h * 0.46;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = document.body.dataset.theme === "dark" ? "#050505" : "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const sr = buffer.sampleRate;
  const duration = buffer.duration || state.clipDuration || 0;
  const effectiveWindow = Math.max(0.1, windowSec || duration || 1);

  let startTime = Math.max(0, centerTime - effectiveWindow / 2);
  let endTime = Math.min(duration, startTime + effectiveWindow);
  if ((endTime - startTime) < effectiveWindow) {
    startTime = Math.max(0, duration - effectiveWindow);
    endTime = duration;
  }

  const startSample = Math.max(0, Math.floor(startTime * sr));
  const endSample = Math.min(buffer.length, Math.floor(endTime * sr));
  const totalSamples = Math.max(1, endSample - startSample);
  const samplesPerPixel = Math.max(1, Math.floor(totalSamples / Math.max(1, w)));

  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));

  const mode = resolvedWaveformMode();
  const isDark = document.body.dataset.theme === "dark";

  if (mode === "overlay" && channels.length > 1) {
    drawOneWaveformTrace(ctx, channels, startSample, endSample, samplesPerPixel, mid, amp, "left", isDark ? "#4fa3e3" : "#1f77b4", Math.max(1, ratio));
    drawOneWaveformTrace(ctx, channels, startSample, endSample, samplesPerPixel, mid, amp, "right", isDark ? "#ff9f4a" : "#ff7f0e", Math.max(1, ratio));
  } else {
    drawOneWaveformTrace(ctx, channels, startSample, endSample, samplesPerPixel, mid, amp, mode, isDark ? "#f1f1f1" : "#000000", Math.max(1, ratio));
  }

  ctx.strokeStyle = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  ctx.fillStyle = isDark ? "#d8d8d8" : "#333";
  ctx.font = `${11 * ratio}px Manrope, sans-serif`;
  ctx.fillText(`waveform: ${mode}`, 8 * ratio, 16 * ratio);
}

// -----------------------------------------------------------------------------
// Clip rendering
// -----------------------------------------------------------------------------

function renderClipAtTime(t) {
  const sourceFeatures = state.showOriginal && state.clipOriginal ? state.clipOriginal : state.clipFeatures;
  if (!sourceFeatures || !sourceFeatures.length) return;

  const windowInfo = visibleClipWindow(t);
  const start = windowInfo.start;
  const end = windowInfo.end;

  const visible = sourceFeatures.filter(p => p.t >= start && p.t <= end);
  const overviewLabels = sourceFeatures.map(p => `${p.t.toFixed(2)}s`);
  const detailLabels = visible.map(p => `${p.t.toFixed(2)}s`);

  const overlayActive = state.overlayMode && state.clipOriginal && state.clipFeatures && state.clipOriginal.length;
  const overlayVisibleOriginal = overlayActive ? state.clipOriginal.filter(p => p.t >= start && p.t <= end) : null;
  const overlayVisibleProcessed = overlayActive ? state.clipFeatures.filter(p => p.t >= start && p.t <= end) : null;

  Object.entries(state.graphs).forEach(([graphId, g]) => {
    if (overlayActive) {
      refillOverlayChart(g.overview, state.clipFeatures, state.clipOriginal, overviewLabels);
      refillOverlayChart(g.detail, overlayVisibleProcessed, overlayVisibleOriginal, detailLabels);
    } else {
      refillChart(g.overview, sourceFeatures, overviewLabels);
      refillChart(g.detail, visible, detailLabels);
    }

    const fractionStart = state.clipDuration > 0 ? (start / state.clipDuration) : 0;
    const fractionWidth = state.clipDuration > 0 ? ((end - start) / state.clipDuration) : 1;

    g.box.style.left = `${fractionStart * 100}%`;
    g.box.style.width = `${Math.max(2, fractionWidth * 100)}%`;
  });

  const nearest = findNearestPoint(t, sourceFeatures);
  if (nearest) updateLatestValues(nearest);

  const seg = state.showOriginal && state.clipOriginalMeta ? findCurrentSegment(t, state.clipOriginalMeta.segments || []) : findCurrentSegment(t, state.clipSegments);
  const segEl = document.getElementById("currentSegment");
  if (segEl) {
    const valueEl = segEl.querySelector(".segment-value");
    const text = seg ? `${seg.type} (${seg.start.toFixed(2)}s ⇄ ${seg.end.toFixed(2)}s)` : "none";
    if (valueEl) valueEl.textContent = text;
    else segEl.textContent = `Current segment: ${text}`;
  }

  if (state.clipFrameHopSec > 0) {
    const w = visibleClipWindow(t);
    const useMel = state.showOriginal && state.clipOriginalMeta && state.clipOriginalMeta.mel ? state.clipOriginalMeta.mel : state.clipMel;
    const hop = state.showOriginal && state.clipOriginalMeta && state.clipOriginalMeta.hop ? state.clipOriginalMeta.hop : state.clipFrameHopSec;
    if (useMel) {
      const startIdx = Math.floor(w.start / hop);
      const endIdx = Math.ceil(w.end / hop);
      renderSpectrogramCanvas(state.clipSpecCtx, useMel, startIdx, endIdx, true);
      renderOverviewWithWindow(useMel, startIdx, endIdx);
    }
  }

  if (state.clipWaveformCtx) {
    const buffer = activeWaveformBuffer();
    if (buffer) {
      drawAudioBufferWaveform(buffer, t, state.clipWindowSec);
    } else {
      resizeCanvasToDisplaySize(state.clipWaveformCtx.canvas, window.devicePixelRatio || 1);
      const w = visibleClipWindow(t);
      const useFeatures = state.showOriginal && state.clipOriginal ? state.clipOriginal : state.clipFeatures;
      const windowed = useFeatures.filter(p => p.t >= w.start && p.t <= w.end);
      drawWaveform(windowed);
    }
  }

  if (sourceFeatures && sourceFeatures.length) {
    const w = visibleClipWindow(t);
    const hop = state.showOriginal && state.clipOriginalMeta && state.clipOriginalMeta.hop ? state.clipOriginalMeta.hop : state.clipFrameHopSec;
    const startIdx = Math.max(0, Math.floor(w.start / hop));
    const endIdx = Math.min(sourceFeatures.length, Math.ceil(w.end / hop));
    const windowFrames = sourceFeatures.slice(startIdx, endIdx);
    drawHeatmap(windowFrames, startIdx);
  }

  renderSpectrumComparison();
}

function drawWaveform(frames) {
  const ctx = state.clipWaveformCtx;
  if (!ctx) return;
  const ratio = window.devicePixelRatio || 1;
  resizeCanvasToDisplaySize(ctx.canvas, ratio);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const pad = 6 * ratio;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
  ctx.fillRect(0, 0, w, h);

  if (!frames || !frames.length) return;

  const vals = frames.map(f => pickWaveValue(f));
  const max = Math.max(...vals, 1e-6);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.92)";
  ctx.lineWidth = 2 * ratio;
  ctx.beginPath();
  for (let i = 0; i < w; i++) {
    const idx = Math.min(vals.length - 1, Math.floor((i / w) * vals.length));
    const v = vals[idx] / max;
    const y = h / 2 - (v * (h / 2 - pad));
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.beginPath();
  for (let i = 0; i < w; i++) {
    const idx = Math.min(vals.length - 1, Math.floor((i / w) * vals.length));
    const v = vals[idx] / max;
    const y = h / 2 + (v * (h / 2 - pad));
    if (i === 0) ctx.moveTo(i, y);
    else ctx.lineTo(i, y);
  }
  ctx.stroke();
}

async function handleClipUpload() {
  const fileInput = document.getElementById("audioFile");
  const status = document.getElementById("uploadStatus");
  const summary = document.getElementById("clipSummary");
  const spectroStatus = document.getElementById("spectrogramStatus");
  const player = document.getElementById("player");
  const filters = collectSelectedFilters();
  const playbackFilters = collectSelectedPlaybackFilters();
  const channelMode = collectChannelMode();

  if (!fileInput.files.length) {
    status.textContent = "Choose an audio file first.";
    return;
  }

  const selectedFile = fileInput.files[0];
  await decodeUploadedAudioForWaveform(selectedFile);

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("filters", JSON.stringify(filters));
  formData.append("channel_mode", channelMode);
    formData.append("filter_config", JSON.stringify(collectFilterConfig()));
    formData.append("noise_experiment", JSON.stringify(collectNoiseExperiment()));

  status.textContent = "Uploading and processing...";
  spectroStatus.textContent = "Rendering spectrogram...";
  summary.innerHTML = "";

  try {
    const res = await fetch("/analyze_clip", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const txt = await res.text();
      status.textContent = "Processing failed: " + txt;
      if (player) {
        player.src = "/clip_audio?variant=processed";
        player.load();
        setupPlaybackGraph();
      }
      return;
    }

    const result = await res.json();

    state.currentMode = "clip";
    setModeChip();
    state.showOriginal = state.activeClipVariant === "original";
    state.clipFeatures = result.features || [];
    state.clipSegments = result.segments || [];
    state.clipBoundaries = result.boundaries || [];
    state.clipDuration = (result.summary && result.summary.durationSec) ? result.summary.durationSec : 0;
    state.clipMel = result.melSpectrogram || null;
    state.clipFrameHopSec = result.melFrameHopSec || 0.01;
    state.lastResult = result;
    state.spectra = result.spectra || null;
    state.filterResponse = result.filterResponse || null;
    state.metricComparison = result.metricComparison || null;
    state.channelSpectra = result.channelSpectra || null;
    state.melDifference = result.melDifference || null;
    state.lastTiming = result.timing || null;
    state.lastChannelMode = result.channelMode || channelMode;
    state.lastStereoDiagnostics = result.stereo || null;
    renderStereoDiagnostics(state.lastStereoDiagnostics, state.lastChannelMode);

    if (result.original) {
      state.clipOriginal = result.original.features || null;
      state.clipOriginalMeta = {
        segments: result.original.segments || [],
        boundaries: result.original.boundaries || [],
        duration: (result.original.summary && result.original.summary.durationSec) ? result.original.summary.durationSec : 0,
        mel: result.original.melSpectrogram || null,
        hop: result.original.melFrameHopSec || state.clipFrameHopSec,
      };
    } else {
      state.clipOriginal = null;
      state.clipOriginalMeta = null;
    }

    const activeBoundaries = state.showOriginal && state.clipOriginalMeta ? (state.clipOriginalMeta.boundaries || []) : state.clipBoundaries;
    renderBoundaryList(activeBoundaries);
    renderClipAtTime(0);

    const hasSpectro = state.showOriginal && state.clipOriginalMeta ? !!state.clipOriginalMeta.mel : !!state.clipMel;
    spectroStatus.textContent = hasSpectro ? "" : "Spectrogram not available.";

    const s = result.summary || {};
    const filterLabel = summarizeFilters(filters);
    const playbackLabel = summarizeFilters(playbackFilters);
    summary.innerHTML = "";
    const rows = [
      ["Duration", `${(s.durationSec ?? 0).toFixed(2)} s`],
      ["Frames", `${Math.round(s.numFrames ?? 0)}`],
      ["Channels", `${result.channelCount ?? s.channelCount ?? 1}`],
      ["Analysis channel", `${result.channelMode ?? channelMode}`],
      ["L/R correlation", result.stereo && result.stereo.leftRightCorrelation !== undefined ? `${result.stereo.leftRightCorrelation.toFixed(3)}` : "-"],
      ["Stereo width", result.stereo && result.stereo.stereoWidth !== undefined ? `${result.stereo.stereoWidth.toFixed(3)}` : "-"],
      ["Processing time", `${(s.processingTimeSec ?? 0).toFixed(2)} s`],
      ["Speed factor", `${(s.speedFactor ?? 0).toFixed(1)}x`],
      ["Analysis filters", filterLabel],
      ["Playback filters", playbackLabel],
      ["Mean RMS dB", `${(s.meanRmsDb ?? 0).toFixed(2)}`],
      ["Mean F0", `${(s.meanF0 ?? 0).toFixed(2)} Hz`],
      ["Speech confidence", `${(s.meanSpeechConfidence ?? 0).toFixed(2)}`],
      ["Boundary confidence", `${(s.meanBoundaryConfidence ?? 0).toFixed(2)}`],
      ["Voiced ratio", `${(s.voicedFrameRatio ?? 0).toFixed(2)}`],
      ["Speech-like ratio", `${(s.speechLikeRatio ?? 0).toFixed(2)}`],
      ["Segments", `${state.clipSegments.length}`],
      ["Boundaries", `${state.clipBoundaries.length}`],
    ];
    rows.forEach(([label, value]) => {
      const div = document.createElement("div");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      div.appendChild(strong);
      div.appendChild(document.createTextNode(value));
      summary.appendChild(div);
    });

    status.textContent = "Processing done. Press play, then toggle playback filters to hear them immediately.";
    updateViewButtons();
    state.lastFilterPayload = filters;

    rebuildGraphDatasets("g1");
    rebuildGraphDatasets("g2");

    const variant = state.showOriginal ? "original" : "processed";
    player.src = `/clip_audio?variant=${variant}`;
    player.load();
    setupPlaybackGraph();

    // Decode the backend-processed WAV as well, so the waveform is a real sample waveform.
    // If this fails, the uploaded original buffer is still used as fallback.
    await decodeServerClipForWaveform("processed");
    if (state.clipOriginal) await decodeServerClipForWaveform("original");
    renderClipAtTime(0);
    renderSpectrumComparison();
  } catch (err) {
    status.textContent = "Processing failed: " + err;
    spectroStatus.textContent = "Spectrogram failed to load.";
    if (player) {
      player.src = "/clip_audio?variant=processed";
      player.load();
      setupPlaybackGraph();
    }
  }
}

// -----------------------------------------------------------------------------
// Report-ready filter experiment
// -----------------------------------------------------------------------------

function formatExperimentValue(value, digits = 2, suffix = "") {
  if (typeof value !== "number" || !isFinite(value)) return "-";
  return `${value.toFixed(digits)}${suffix}`;
}

function renderFilterExperimentTable(exp) {
  const table = state.filterExperimentTable || document.getElementById("filterExperimentTable");
  const status = state.filterExperimentStatus || document.getElementById("filterExperimentStatus");
  if (!table) return;

  if (!exp || !Array.isArray(exp.rows) || !exp.rows.length) {
    table.innerHTML = "";
    if (status) status.textContent = "No experiment run yet.";
    return;
  }

  const cols = [
    ["condition", "Condition"],
    ["rmsDb", "RMS dB"],
    ["rmsDbChange", "Δ RMS"],
    ["spectralCentroidHz", "Centroid Hz"],
    ["spectralCentroidChangeHz", "Δ Centroid"],
    ["lowEnergyRatio", "Low ratio"],
    ["speechEnergyRatio", "Speech ratio"],
    ["highEnergyRatio", "High ratio"],
    ["spectralFlatness", "Flatness"],
    ["meanSpeechConfidence", "Speech conf."],
    ["speechLikeRatio", "Speech-like"],
    ["processingTimeSec", "Time s"],
    ["speedFactor", "Speed x"],
  ];

  let html = "<thead><tr>" + cols.map(c => `<th>${c[1]}</th>`).join("") + "</tr></thead><tbody>";
  exp.rows.forEach(row => {
    html += "<tr>";
    cols.forEach(([key]) => {
      const v = row[key];
      if (key === "condition") html += `<td><strong>${v || "-"}</strong></td>`;
      else if (key.includes("Ratio") || key === "spectralFlatness" || key === "meanSpeechConfidence" || key === "speechLikeRatio") html += `<td>${formatExperimentValue(v, 3)}</td>`;
      else if (key === "speedFactor") html += `<td>${formatExperimentValue(v, 1, "x")}</td>`;
      else if (key === "processingTimeSec") html += `<td>${formatExperimentValue(v, 2)}</td>`;
      else if (key.includes("Hz")) html += `<td>${formatExperimentValue(v, 0)}</td>`;
      else html += `<td>${formatExperimentValue(v, 2)}</td>`;
    });
    html += "</tr>";
  });
  html += "</tbody>";
  table.innerHTML = html;

  if (status) {
    const dur = formatExperimentValue(exp.audioDurationSec, 2, " s");
    const total = formatExperimentValue(exp.totalProcessingTimeSec, 2, " s");
    status.textContent = `Experiment complete. Channel=${exp.channelMode}, duration=${dur}, total processing=${total}.`;
  }
}

async function runFilterExperiment() {
  const fileInput = document.getElementById("audioFile");
  const status = state.filterExperimentStatus || document.getElementById("filterExperimentStatus");
  if (!fileInput || !fileInput.files.length) {
    if (status) status.textContent = "Choose an audio file first.";
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  formData.append("channel_mode", collectChannelMode());
  formData.append("filter_config", JSON.stringify(collectFilterConfig()));
  formData.append("noise_experiment", JSON.stringify(collectNoiseExperiment()));
  formData.append("current_filters", JSON.stringify(collectSelectedFilters()));

  if (status) status.textContent = "Running filter experiment...";

  try {
    const res = await fetch("/run_filter_experiment", { method: "POST", body: formData });
    if (!res.ok) {
      const txt = await res.text();
      if (status) status.textContent = "Experiment failed: " + txt;
      return;
    }
    const exp = await res.json();
    state.filterExperiment = exp;
    renderFilterExperimentTable(exp);
    if (exp.stereo) renderStereoDiagnostics(exp.stereo, exp.channelMode || collectChannelMode());
  } catch (err) {
    if (status) status.textContent = "Experiment failed: " + err;
  }
}

function experimentCsv(exp) {
  if (!exp || !Array.isArray(exp.rows)) return "";
  const headers = [
    "condition", "filters", "rmsDb", "rmsDbChange", "spectralCentroidHz", "spectralCentroidChangeHz",
    "spectralRolloffHz", "lowEnergyRatio", "speechEnergyRatio", "highEnergyRatio", "spectralFlatness",
    "spectralFlux", "zcr", "meanSpeechConfidence", "meanBoundaryConfidence", "voicedFrameRatio",
    "speechLikeRatio", "processingTimeSec", "speedFactor"
  ];
  const esc = (v) => {
    if (Array.isArray(v)) v = v.join("+");
    if (v === null || v === undefined) v = "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(",")];
  exp.rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(",")));
  return lines.join("\n");
}

function downloadTextFile(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportFilterExperimentCsv() {
  if (!state.filterExperiment) {
    const status = state.filterExperimentStatus || document.getElementById("filterExperimentStatus");
    if (status) status.textContent = "Run the experiment before exporting.";
    return;
  }
  downloadTextFile("filter_experiment_results.csv", experimentCsv(state.filterExperiment), "text/csv");
}

function exportFilterExperimentJson() {
  if (!state.filterExperiment) {
    const status = state.filterExperimentStatus || document.getElementById("filterExperimentStatus");
    if (status) status.textContent = "Run the experiment before exporting.";
    return;
  }
  downloadTextFile("filter_experiment_results.json", JSON.stringify(state.filterExperiment, null, 2), "application/json");
}

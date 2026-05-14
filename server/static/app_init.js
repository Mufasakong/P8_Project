function setModeChip() {
  if (!state.modeChipEl) return;
  state.modeChipEl.textContent = state.currentMode === "clip" ? "Mode: clip" : "Mode: live";
}

function updateViewButtons() {
  const viewProcessedBtn = document.getElementById("viewProcessedBtn");
  const viewOriginalBtn = document.getElementById("viewOriginalBtn");
  if (!viewProcessedBtn || !viewOriginalBtn) return;
  if (state.showOriginal) {
    viewOriginalBtn.classList.add("btn-primary");
    viewOriginalBtn.classList.remove("btn-secondary");
    viewProcessedBtn.classList.add("btn-secondary");
    viewProcessedBtn.classList.remove("btn-primary");
  } else {
    viewProcessedBtn.classList.add("btn-primary");
    viewProcessedBtn.classList.remove("btn-secondary");
    viewOriginalBtn.classList.add("btn-secondary");
    viewOriginalBtn.classList.remove("btn-primary");
  }
  viewOriginalBtn.disabled = !state.clipOriginal;
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  if (state.themeToggle) state.themeToggle.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  localStorage.setItem("prosody-theme", theme);
  updateChartTheme();
}

function initTheme() {
  const savedTheme = localStorage.getItem("prosody-theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme || (prefersDark ? "dark" : "light"));
  if (state.themeToggle) {
    state.themeToggle.addEventListener("click", () => {
      const next = document.body.dataset.theme === "dark" ? "light" : "dark";
      applyTheme(next);
      if (state.currentMode === "clip") {
        const player = document.getElementById("player");
        renderClipAtTime(player ? player.currentTime || 0 : 0);
        renderSpectrumComparison();
      }
    });
  }
}

function initWs() {
  state.wsUrl = state.wsScheme + location.host + "/ws";
  state.ws = new WebSocket(state.wsUrl);
  state.prosodyWs = (document.body.dataset.prosodyWs || "ws://localhost:8765").replace(/^http/, "ws");
  if (state.sourceValueEl) state.sourceValueEl.textContent = state.prosodyWs;
  state.ws.onmessage = (e) => {
    const d = safeJsonParse(e.data);
    if (!d || state.micUseDisplaySocket) return;
    handleProsodyMessage(d);
  };
}

function initUiHandlers() {
  document.getElementById("windowSizeSelect").addEventListener("change", (e) => {
    state.clipWindowSec = parseFloat(e.target.value);
    if (state.currentMode === "clip") {
      const player = document.getElementById("player");
      renderClipAtTime(player ? player.currentTime || 0 : 0);
      renderSpectrumComparison();
    }
  });

  if (state.channelModeSelect) {
    state.channelModeSelect.addEventListener("change", () => {
      if (state.uploadStatusEl) {
        state.uploadStatusEl.textContent = "Channel mode changed. Press Process clip to recompute analysis for this channel.";
      }
    });
  }

  if (state.waveformModeSelect) {
    state.waveformModeSelect.addEventListener("change", () => {
      if (state.currentMode === "clip") {
        const player = document.getElementById("player");
        renderClipAtTime(player ? player.currentTime || 0 : 0);
      }
    });
  }

  document.getElementById("micStartBtn").onclick = async () => {
    document.getElementById("micStartBtn").disabled = true;
    document.getElementById("micStopBtn").disabled = false;
    await startMicStream();
  };

  document.getElementById("micStopBtn").onclick = () => {
    document.getElementById("micStartBtn").disabled = false;
    document.getElementById("micStopBtn").disabled = true;
    stopMicStream();
  };

  document.getElementById("liveModeBtn").onclick = () => {
    state.currentMode = "live";
    state.clipFeatures = [];
    state.clipSegments = [];
    state.clipBoundaries = [];
    state.clipDuration = 0;
    state.clipMel = null;
    state.rawAudioBuffer = null;
    state.processedAudioBuffer = null;
    state.originalAudioBuffer = null;
    state.spectra = null;
    state.lastTiming = null;
    state.lastStereoDiagnostics = null;
    state.filterExperiment = null;
    if (state.filterExperimentTable) state.filterExperimentTable.innerHTML = "";
    if (state.filterExperimentStatus) state.filterExperimentStatus.textContent = "No experiment run yet.";
    if (typeof renderStereoDiagnostics === "function") renderStereoDiagnostics(null, "mixdown");
    state.draggingOverview = false;
    state.liveFrames = [];
    state.liveSpecCols = [];
    state.liveMelTimes = [];
    clearAllCharts();
    document.getElementById("uploadStatus").textContent = "Switched back to live mode.";
    setModeChip();
    document.getElementById("clipSummary").innerHTML = "";
    const segEl = document.getElementById("currentSegment");
    if (segEl) {
      const valueEl = segEl.querySelector(".segment-value");
      if (valueEl) valueEl.textContent = "none";
      else segEl.textContent = "Current segment: none";
    }
    document.getElementById("boundaryList").innerHTML = "";
    document.getElementById("spectrogramStatus").textContent = "Upload a clip to render.";
    clearCanvas(state.clipSpecCtx);
    clearCanvas(state.clipSpecOverviewCtx);
    clearCanvas(state.heatmapCtx);
    clearCanvas(state.clipWaveformCtx);
    if (state.spectrumOriginal) clearCanvas(state.spectrumOriginal.getContext("2d"));
    if (state.spectrumProcessed) clearCanvas(state.spectrumProcessed.getContext("2d"));
    if (state.filterResponseCanvas) clearCanvas(state.filterResponseCanvas.getContext("2d"));
    if (state.diffSpectrogram) clearCanvas(state.diffSpectrogram.getContext("2d"));
    [state.channelSpectrumLeft,state.channelSpectrumRight,state.channelSpectrumMid,state.channelSpectrumSide].forEach(c => { if (c) clearCanvas(c.getContext("2d")); });
    if (state.metricComparisonTable) state.metricComparisonTable.innerHTML = "";
    state.baselineStats = null;
    if (baselineNormalize) baselineNormalize.checked = false;
    if (baselineStatus) baselineStatus.textContent = "No baseline captured.";
  };

  window.addEventListener("beforeunload", () => {
    stopMicStream();
  });

  const player = document.getElementById("player");
  player.addEventListener("timeupdate", () => {
    if (state.currentMode !== "clip") return;
    renderClipAtTime(player.currentTime);
  });
  player.addEventListener("play", async () => {
    if (state.currentMode !== "clip") return;
    setupPlaybackGraph();
    await resumePlaybackContext();
    renderClipAtTime(player.currentTime);
  });
  player.addEventListener("seeked", () => {
    if (state.currentMode !== "clip") return;
    renderClipAtTime(player.currentTime);
  });

  if (state.clipSpecOverview) {
    state.clipSpecOverview.addEventListener("mousedown", (e) => {
      if (state.currentMode !== "clip") return;
      state.draggingOverview = true;
      seekFromOverviewEvent(e);
    });
  }
  window.addEventListener("mousemove", (e) => {
    if (!state.draggingOverview || state.currentMode !== "clip") return;
    seekFromOverviewEvent(e);
  });
  window.addEventListener("mouseup", () => {
    state.draggingOverview = false;
  });

  document.getElementById("uploadBtn").onclick = handleClipUpload;

  const runExperimentBtn = document.getElementById("runFilterExperimentBtn");
  const exportExperimentCsvBtn = document.getElementById("exportExperimentCsvBtn");
  const exportExperimentJsonBtn = document.getElementById("exportExperimentJsonBtn");
  if (runExperimentBtn) runExperimentBtn.onclick = runFilterExperiment;
  if (exportExperimentCsvBtn) exportExperimentCsvBtn.onclick = exportFilterExperimentCsv;
  if (exportExperimentJsonBtn) exportExperimentJsonBtn.onclick = exportFilterExperimentJson;

  const baselineNormalize = state.baselineNormalize;
  const baselineCalibrateBtn = state.baselineCalibrateBtn;
  const baselineClearBtn = state.baselineClearBtn;
  const baselineStatus = state.baselineStatus;
  if (baselineNormalize) {
    baselineNormalize.addEventListener("change", () => rerenderCurrentMode());
  }
  if (baselineCalibrateBtn) {
    baselineCalibrateBtn.addEventListener("click", () => {
      if (!state.clipFeatures || !state.clipFeatures.length) {
        if (baselineStatus) baselineStatus.textContent = "Upload a clip before calibrating.";
        return;
      }
      const source = state.showOriginal && state.clipOriginal ? state.clipOriginal : state.clipFeatures;
      state.baselineStats = computeBaselineFromFeatures(source);
      if (baselineStatus) baselineStatus.textContent = state.baselineStats ? "Baseline captured from current clip." : "Baseline capture failed.";
      rerenderCurrentMode();
    });
  }
  if (baselineClearBtn) {
    baselineClearBtn.addEventListener("click", () => {
      state.baselineStats = null;
      if (baselineStatus) baselineStatus.textContent = "Baseline cleared.";
      if (baselineNormalize) baselineNormalize.checked = false;
      rerenderCurrentMode();
    });
  }

  const viewProcessedBtn = document.getElementById("viewProcessedBtn");
  const viewOriginalBtn = document.getElementById("viewOriginalBtn");
  const overlayToggle = document.getElementById("overlayToggle");

  if (viewProcessedBtn) {
    viewProcessedBtn.addEventListener("click", () => {
      state.showOriginal = false;
      state.activeClipVariant = "processed";
      updateViewButtons();
      const t = player.currentTime || 0;
      player.src = "/clip_audio?variant=processed";
      player.load();
      player.onloadedmetadata = () => { player.currentTime = Math.min(t, player.duration || t); };
      setupPlaybackGraph();
      if (state.currentMode === "clip") renderClipAtTime(t);
    });
  }
  if (viewOriginalBtn) {
    viewOriginalBtn.addEventListener("click", () => {
      if (!state.clipOriginal) {
        if (state.uploadStatusEl) state.uploadStatusEl.textContent = "No original clip data available yet.";
        return;
      }
      state.showOriginal = true;
      state.activeClipVariant = "original";
      updateViewButtons();
      const t = player.currentTime || 0;
      player.src = "/clip_audio?variant=original";
      player.load();
      player.onloadedmetadata = () => { player.currentTime = Math.min(t, player.duration || t); };
      setupPlaybackGraph();
      if (state.currentMode === "clip") renderClipAtTime(t);
    });
  }
  if (overlayToggle) {
    overlayToggle.addEventListener("change", () => {
      state.overlayMode = overlayToggle.checked;
      rebuildGraphDatasets("g1");
      rebuildGraphDatasets("g2");
      updateChartTheme();
      if (state.currentMode === "clip") renderClipAtTime(player.currentTime || 0);
    });
  }
}

function initContext() {
  state.clipSpecCtx = state.clipSpec.getContext("2d");
  state.clipSpecOverviewCtx = state.clipSpecOverview.getContext("2d");
  state.liveSpecCtx = state.liveSpec.getContext("2d");
  state.heatmapCtx = state.heatmap.getContext("2d");
  if (state.clipWaveform) {
    state.clipWaveformCtx = state.clipWaveform.getContext("2d");
    resizeCanvasToDisplaySize(state.clipWaveform, window.devicePixelRatio || 1);
  }
  window.addEventListener("resize", () => {
    if (state.clipWaveform) resizeCanvasToDisplaySize(state.clipWaveform, window.devicePixelRatio || 1);
    if (state.currentMode === "clip") {
      const player = document.getElementById("player");
      renderClipAtTime(player ? player.currentTime || 0 : 0);
      renderSpectrumComparison();
    }
  });
}

function initDashboard() {
  initContext();
  initCharts();
  initTheme();
  initWs();
  initUiHandlers();
  initPlaybackFilterClicks();
  rebuildSignalToggles();
}

initDashboard();

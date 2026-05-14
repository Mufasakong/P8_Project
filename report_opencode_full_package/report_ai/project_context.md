# Project context for report writing

The project is now focused on signal processing.

## Current project identity

Title direction:
Stereo-Aware Audio Signal Processing for Speech Activity and Prosody Analysis

The main system is a browser-based dashboard with a Python signal-processing backend.

Unity is optional. It can still send live PCM audio over WebSocket, but Unity is not the main contribution.

## Main capabilities

The dashboard supports:
- uploading audio clips
- stereo clip analysis
- analysis channel selection:
  - mixdown
  - left
  - right
  - mid
  - side
- high-pass, low-pass, and band-pass filters
- adjustable filter cutoffs during playback
- spectral noise suppression
- RMS normalization
- pre-emphasis
- real waveform drawing from raw samples
- mel spectrogram
- before/after FFT spectrum
- difference spectrogram
- stereo diagnostics
- filter experiment table
- CSV/JSON export
- processing-time and speed-factor measurements

## Important distinction

There are two paths:

1. Playback path:
   - runs in the browser
   - filter sliders update sound immediately while listening

2. Analysis path:
   - runs in Python
   - recomputes STFT, mel spectrogram, MFCC, VAD, pitch, metrics
   - requires pressing Process clip again

## Serious signal-processing filters

Keep in main report:
- high-pass
- low-pass
- band-pass
- noise suppression
- normalization
- pre-emphasis

Do not focus on:
- distortion
- tremolo
- sawtooth modulation
- ring modulation
- bitcrush
- echo

Echo may be mentioned only as a playback demonstration effect, not as the core signal-processing pipeline.

## Evaluation results currently available

Use actual values only if they are present in report.tex or exported CSVs.

Example filter experiment result from one clip:
- raw RMS dB around -40.65
- raw spectral centroid around 1612 Hz
- raw low ratio around 0.704
- raw speech ratio around 0.292
- high-pass 80 Hz reduced low ratio to around 0.060
- band-pass 80--4000 Hz increased speech ratio to around 0.940
- low-pass 4000 Hz reduced high ratio to approximately 0.000
- pre-emphasis increased centroid to around 3583 Hz and high ratio to around 0.329

Only use these values if they match the current CSV/results.

## Report style

Write as a technical signal-processing report.

Main report:
- problem
- theory
- implementation
- evaluation
- discussion
- conclusion

Appendix:
- Unity
- ML experiments
- backchannel application
- extra screenshots

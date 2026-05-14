# Report rubric: Signal-processing project

Target grade: Danish 12-level.

The report must be a serious signal-processing report, not a software demo.

## Must include

1. Clear problem definition:
   - stereo-aware audio signal processing for speech/prosody analysis
   - browser dashboard as main system
   - Unity/WebSocket support only as optional extension

2. Signal-processing theory:
   - sampling and sampling rate
   - mono vs stereo
   - left/right, mixdown, mid/side
   - Nyquist frequency
   - framing/windowing
   - STFT/FFT
   - mel spectrogram
   - MFCC
   - RMS energy and dB
   - spectral centroid
   - spectral rolloff
   - spectral flatness
   - spectral flux
   - pitch/F0 and voiced ratio
   - adaptive noise floor
   - SNR-like VAD

3. Filters:
   - high-pass filter
   - low-pass filter
   - band-pass filter
   - pre-emphasis
   - normalization
   - spectral noise suppression
   - explain why each is used

4. Mathematical definitions:
   - RMS
   - dB conversion
   - STFT
   - spectral centroid
   - spectral flux
   - mid/side stereo transformation
   - precision/recall/F1 only if VAD evaluation is included

5. Implementation:
   - describe Python backend
   - describe browser dashboard
   - describe stereo channel selector
   - describe live playback filtering vs offline analysis
   - describe exportable experiment results

6. Evaluation:
   - filter experiment table
   - before/after spectrum
   - before/after mel spectrogram
   - stereo diagnostics
   - processing time and real-time factor
   - optional VAD result if available

7. Discussion:
   - what worked
   - what did not work
   - limitations
   - stereo limitations
   - browser playback vs Python analysis distinction
   - why Unity is optional

8. Appendix:
   - Unity integration
   - ML/backchannel experiments
   - extra implementation details

## Must avoid

- Do not claim reliable backchannel prediction in the main report.
- Do not make ML the main contribution.
- Do not describe echo/distortion/tremolo/bitcrush as serious preprocessing.
- Do not invent results.
- Do not include results unless they exist in report text, CSV, figures, or screenshots.
- Do not overclaim that the system is production-ready.

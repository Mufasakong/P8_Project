# Fix log for new figure naming and LEFT_RIGHT stereo update

Date: 2026-05-01

Edited files:
- `M:\M77\P8_Project\report\report.tex`
- `M:\M77\P8_Project\report\fix_log_latest.md`

## Main-report figures used

- `figures/HARVARD_filter_comparison_spectrum_before_after.png`
- `figures/HARVARD_speech_harvard_mel_spectrogram.png`
- `figures/LEFT_RIGHT_stereo_channel_comparison_lrtest.png`

## Appendix figures used

- `figures/LEFT_RIGHT_filter_response_bandpass_demo.png`
- `figures/LEFT_RIGHT_speech_original_mel.png`
- `figures/LEFT_RIGHT_speech_processed_mel_bandpass_demo.png`

These appendix figures are explicitly framed as dashboard demonstrations only. The narrow band-pass response and before/after mel examples are not used as authoritative Harvard 80--4000 Hz quantitative evidence.

## Horse experiment removal

The old horse stereo experiment was fully removed from `report.tex`.

Removed references include:
- `horse clip`
- `horse recording`
- `filter_experiment_mixdown_horse`
- old `Stero_channel_comparison.png` figure reference

The stereo section now uses the LEFT_RIGHT stereo test clip and `filter_experiment_mixdown_stereo_lrtest.json`.

## LEFT_RIGHT result availability

The new LEFT_RIGHT result files were available and used:
- `results/filter_experiment_mixdown_stereo_lrtest.csv`
- `results/filter_experiment_mixdown_stereo_lrtest.json`

The report now uses the exported LEFT_RIGHT stereo diagnostics:
- left RMS dB `-30.64`
- right RMS dB `-30.59`
- balance left-minus-right dB `-0.04`
- left-right correlation `-0.000007`
- mid RMS dB `-33.63`
- side RMS dB `-33.63`
- stereo width `0.5000`

## Harvard result handling

The Harvard speech/filter experiment remains the main quantitative result section. Existing Harvard CSV/JSON values were preserved, and the main Harvard figures were updated to the new naming scheme:
- `HARVARD_filter_comparison_spectrum_before_after.png`
- `HARVARD_speech_harvard_mel_spectrogram.png`

## Remaining limitations

- The appendix LEFT_RIGHT band-pass and mel screenshots are illustrative dashboard evidence, not matched Harvard quantitative results.
- The Harvard spectrum and mel PNGs still lack full plotting metadata such as exact dB scale and filter-state encoding.
- VAD/F0 remain backend diagnostic outputs only; no VAD or F0 accuracy is claimed.
- Timing remains a single exported diagnostic run, not a repeated benchmark.
- `pdflatex` could not be run in this environment because it is not installed on PATH.

# Final Submission Review

## Estimated grade

Estimated Danish grade: **10**. The report is now a credible compact final submission: it is clearly framed as a signal-processing report, uses the Harvard export appropriately for speech/filter evidence, uses the horse clip only for stereo diagnostics, gives real numeric results, and avoids overclaiming VAD/F0 accuracy. It is not clearly a 12 because the evidence is still mostly aggregate CSV/JSON descriptors rather than strong frame-level validation, and the final PDF still needs an actual compile check.

## Remaining blockers

- The report has not been compile-verified in this environment. All referenced figure files exist, but `pdflatex` is not available here, so final PDF generation remains a real submission blocker until checked locally.
- Table 2 now defines speed factor correctly, but the column header is still only `Speed`. This is not wrong because the caption defines it, but for final clarity it should say `Speed factor`.
- The report still lacks true filter magnitude-response, VAD overlay and F0 track figures. This is correctly framed as a limitation, so it is no longer a wording blocker, but it still caps the grade because the evidence remains aggregate rather than fully diagnostic.

## Must-fix before submission

1. Compile the report locally and fix any LaTeX/package/figure warnings.
2. Rename the Table 2 column from `Speed` to `Speed factor` for unambiguous timing terminology.

These are narrow final-polish edits, not a request for broad expansion.

## Optional improvements

- Add a true Butterworth magnitude-response figure if it can be generated from the existing backend parameters without inventing experimental results.
- Add a concise note on whether timing includes decoding and file I/O if this is known from the backend.
- Use `references.bib` directly or remove unused external bibliography material from the final submission package. The inline bibliography is now method-consistent, but the separate `.bib` still contains unused AMI references.

## Pass/fail check against final blocker list

| Criterion | Status | Comment |
|---|---|---|
| Timing terminology correct | Pass with minor polish | Speed factor is defined as audio duration divided by processing time, and RTF is defined as the inverse. No caption incorrectly calls speed factor RTF. The column header should still be renamed from `Speed` to `Speed factor`. |
| Harvard speech experiment valid | Pass | `harvard.wav` is explicitly identified in the report as the speech/filter export, and the numeric filter results are interpreted quantitatively. |
| Horse stereo experiment correctly framed | Pass | The horse clip is used only for stereo/channel diagnostics, not as speech evidence. |
| Backend parameters stated | Pass | Sample rate, frame length, feature rate, rolling window, FFT size, hop, window length/type, mel bands/range, rolloff fraction, MFCC count, VAD thresholds/hangover, F0 method, filter cutoffs, filter order, zero-phase filtering and pre-emphasis coefficient are stated. |
| Filter design stated | Pass | The report states 4th-order Butterworth filters and `scipy.signal.filtfilt` zero-phase forward/backward offline analysis. It does not pretend to include a magnitude-response plot. |
| VAD/F0 not overclaimed | Pass | VAD, speech-like and voiced-ratio values are explicitly described as backend diagnostics only, with no accuracy claim. |
| Figures referenced and qualified | Pass | All included figures are referenced and captions explain what they support and what they cannot prove. |
| Bibliography acceptable | Pass with polish issue | WORLD/pyworld is now cited for DIO+StoneMask, and YIN is no longer implied. The inline bibliography is consistent, but `references.bib` is not used and contains unused entries. |
| No TODO/placeholders in main body | Pass | No TODO markers or empty placeholder tables were found in the report body. |
| Unity/ML not distracting | Pass | Unity/WebSocket is confined to appendix/future work; ML/backchannel material is not part of the main contribution. |

## Final examiner judgement

The report is **submission-ready after a local LaTeX compile check and the small Table 2 header polish**. It is a strong compact report, but not a guaranteed 12 because the strongest remaining weakness is evidence depth: no filter response figure, no VAD/F0 validation figure, no repeated timing benchmark. These limitations are now honestly stated, so they are not fatal submission blockers, but they realistically keep the grade around **10** rather than 12.

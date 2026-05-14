# Strict Danish Examiner Review: Final Submission Blockers

## Estimated grade now

Estimated grade after the latest fixes: **10**.

This is now a serious, compact Signal Processing for Interactive Systems report. It is clearly better than a dashboard demonstration and it uses real exported results. However, it is still not grade 12 because the evidence is too aggregate, the figures are weak as scientific evidence, timing terminology is partly wrong, and VAD/F0 are described but not validated.

## Why it is not 12 yet

The report is well-framed, but grade 12 requires a more convincing chain from signal-processing method to reproducible implementation to evaluated result. The current report gives many correct formulas and real numerical tables, but the strongest results are still aggregate descriptors. There is no true filter magnitude-response plot, no difference spectrogram, no VAD overlay, no F0 track, and no labelled reference against which the VAD/F0 outputs can be judged.

The most concrete correctness issue is in Table 2: the caption says "RTF is computed as processing time divided by 18.35625 s", but the displayed values are the exported `speedFactor` values around 2.1--2.2. True real-time factor would be processing time divided by audio duration, around 0.45--0.48. The text later calls them speed factors, which is correct, but the table caption is wrong and should be fixed before submission.

The bibliography is also not final-submission clean. `references.bib` exists but the report uses an inline `thebibliography`; the cited works in the report do not match the `.bib` file. In particular, pyworld/WORLD is used in the method but the report cites YIN instead, while `references.bib` contains WORLD but is not used. This is not catastrophic, but it is not grade-12 polish.

I could not verify compilation because `pdflatex` is not available on PATH in this environment. The source appears structurally valid and all referenced figure files exist, but this must be compiled locally before submission.

## Strongest parts

- The project is clearly framed as signal processing: exported measurements of stereo reduction, filtering, spectral descriptors, VAD/F0 diagnostics and timing.
- The dashboard is correctly treated as an experimental interface, not the scientific contribution.
- The Harvard speech export is properly used for speech/filter results; its JSON metadata identifies `harvard.wav`.
- The horse clip is correctly used only for stereo/channel diagnostics.
- Filter results are interpreted quantitatively using RMS, centroid, rolloff and low/speech/high band ratios.
- Unity, ML and backchannel material are kept out of the main contribution.
- Implementation parameters are now much stronger: sample rate, frame length, STFT settings, mel settings, VAD thresholds, F0 method, Butterworth order, cutoffs, zero-phase filtering and pre-emphasis coefficient are stated.

## Weakest parts

- The figures are referenced, but they are not strong enough to carry a grade-12 evaluation.
- VAD and F0 remain backend diagnostics, not validated signal-processing results.
- The timing table confuses speed factor and real-time factor.
- The noise suppression method is only briefly described and has no before/after figure or quantitative noise-specific evaluation.
- Bibliography handling is inconsistent with the provided `references.bib`.
- The report relies heavily on aggregate CSV/JSON descriptors; there is little visual or frame-level evidence.

## Missing theory

Only final-blocker theory gaps remain:

- The report does not give the exact window function for STFT.
- MFCCs are described mathematically but not evaluated; the report does not state MFCC coefficient count in the main method section.
- Rolloff fraction is not stated in the report body.
- Noise estimation is described at a high level, but the adaptive update rule and floor/smoothing constants are not given.
- The report says pyworld DIO+StoneMask is used, but cites YIN rather than WORLD/pyworld theory.

These are not large expansion needs, but they are the difference between a good compact report and a fully rigorous one.

## Missing implementation details

- Exact STFT window type.
- Exact rolloff percentage.
- MFCC coefficient count and DCT normalization convention.
- Noise suppression reconstruction details: overlap-add/windowing, gain floor, smoothing and whether phase is reused.
- Timing environment: CPU, Python version, library versions, OS, whether decoding and file I/O are included.
- Whether speed factor is exported as audio-duration divided by processing-time; the table caption currently contradicts this.

## Missing or weak evidence

- No true filter magnitude-response figure for the 4th-order Butterworth high-pass, low-pass and band-pass filters.
- No before/after difference spectrogram, despite the project context saying this capability exists.
- No VAD overlay against waveform or spectrogram.
- No F0 contour plot and no F0 reference.
- No quantitative VAD accuracy, which is acceptable only because the report avoids claiming it.
- No repeated timing runs or variance.
- No separate left/right/mid/side feature table for the stereo experiment.

The existing figures are usable but weak. The spectrum figure is explicitly described as qualitative because it does not encode the selected filter state or dB reference. The mel spectrogram is also qualitative because the PNG lacks plotting scale. The stereo figure supports the table but does not replace a channel-wise numeric export.

## Weak/unsupported claims

- "All Harvard conditions run faster than real time" is supported only if the values are interpreted as speed factor. The table caption must not call these values RTF.
- "Pitch/F0 and VAD outputs" are included in the pipeline description, but the report should keep making clear that these are diagnostic outputs, not evaluated pitch or speech-activity results.
- The conclusion says the system demonstrates a "speech-oriented audio analysis pipeline"; that is fair. It must not be read as validated speech analysis, because there are no labels or reference tracks.
- The statement that the spectrum figure is consistent with the tables is plausible, but weak because the figure lacks state and scale metadata.

## Sections to move/remove

No major section needs moving. The compact structure is appropriate.

Do not expand the report broadly. Keep Unity/WebSocket in the appendix. Keep ML/backchannel outside the main contribution. The main body should remain focused on the Harvard filter experiment and horse stereo diagnostics.

## Exact prioritized fix list

1. Fix the timing caption and terminology: either call the table column "Speed factor" only, or add a separate RTF column with values around 0.45--0.48.
2. Align citations with methods: cite WORLD/pyworld for DIO+StoneMask or remove the misleading YIN connection; make bibliography handling consistent with `references.bib`.
3. State the STFT window type, rolloff percentage and MFCC coefficient count if known.
4. Add one sentence explicitly saying no VAD/F0 accuracy is claimed because no labels/reference tracks are available.
5. Strengthen the figure captions by stating exactly what each figure can and cannot prove.
6. If already available in the system, insert a true filter magnitude-response figure; otherwise keep it as a limitation, not a TODO checklist.
7. Add timing environment and repeated-run information only if already available; otherwise state that timing is a single export diagnostic.
8. Compile locally and fix any LaTeX/package warnings before submission.

## Concrete wording suggestions for the 5 most important fixes

1. Timing:

> The table reports exported speed factor, defined as audio duration divided by processing time. The corresponding real-time factor is its inverse and is below 1 for all conditions.

2. VAD/F0:

> The voiced and speech-like ratios are reported only as backend diagnostics. No VAD accuracy or F0 accuracy is claimed because the export contains no speech/non-speech labels or reference F0 track.

3. Citation alignment:

> Pitch was estimated with WORLD/pyworld DIO followed by StoneMask refinement; therefore the method should cite WORLD/pyworld rather than implying that YIN was used.

4. Figure limitation:

> Figure X supports the direction of the spectral change, but the numerical evidence remains Table X because the PNG does not encode filter condition, dB reference or plotting scale.

5. Filter evidence:

> The high-pass, low-pass and band-pass filters are reproducible from their order, family, cutoffs and zero-phase application; however, no magnitude-response figure is included, so the report evaluates their effect through exported descriptors rather than direct response plots.

## Compilation judgement

Compilation could not be verified here because `pdflatex` is not installed on PATH. Source-level inspection found no missing figure files among the referenced images. The final PDF must still be built locally.

## Final examiner judgement

This report is now a credible compact submission and likely earns around **10**. It is not yet a 12 because the remaining weaknesses are exactly the ones that matter in a signal-processing course: precise timing terminology, method-citation consistency, stronger frame-level/filter evidence, and validated interpretation of VAD/F0. The fixes needed are narrow, not a broad rewrite.

# Refactor Summary

## Updated scripts
- `LatencyEvaluator.cs`
- `PipelineTester.cs`
- `VoiceTest.cs`
- `NpcAgent.cs`
- `LlmService.cs`

## What changed
- Refactored `PipelineTester` into a thin coordinator that resolves an assigned or discovered `LatencyEvaluator` instead of spawning one dynamically.
- Removed stale STT-specific setup and replaced old comments with hook points that match the current `VoiceTest` / `NpcAgent` flow.
- Moved `LatencyEvaluator` log subscription into explicit lifecycle methods.
- Added runtime output folders under `Application.persistentDataPath/Latency`.
- Added `Application.persistentDataPath/Latency/Results` for per-test `.txt` summaries.
- Kept CSV export, added invariant-culture formatting, and escaped CSV text fields.
- Improved debug-log recovery to use full datetime stamps.
- Added safer file IO helpers with warning logs instead of hard crashes on write/read failures.
- Wired the live input/response/audio flow so latency tracking now starts and stops automatically during normal use.

## Live hook points
- `VoiceTest.cs`
  - starts speech timing from VAD speech onset
  - submits input timing when text is broadcast
  - cancels abandoned turns when recording/transcription fails
- `NpcAgent.cs`
  - records first response timing
  - records local Piper audio start/end
  - tracks per-agent pending response counts for external audio
  - cancels stalled ElevenLabs waits with a timeout
- `LlmService.cs`
  - routes ElevenLabs playback start/end/failure back to the matching `NpcAgent`

## Result file behavior
- Session CSV: `Latency/latency_results_<timestamp>.csv`
- Session debug log: `Latency/debug_log_<timestamp>.txt`
- Per-test summary: `Latency/Results/<testId>_<timestamp>.txt`

## Notes
- Legacy wrapper methods remain in `PipelineTester` so existing UnityEvent hookups do not break.
- The new per-test summary files are written whenever a measurement is saved.

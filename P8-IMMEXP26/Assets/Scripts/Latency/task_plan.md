# Task Plan: Revamp latency scripts

## Goal
Refactor the latency tooling and wire it into the current interview pipeline so measurements are captured automatically.

## Phases
- [x] Phase 1: Plan and setup
- [x] Phase 2: Research/gather information
- [x] Phase 3: Execute/build
- [x] Phase 4: Review and deliver

## Key Questions
1. Which coding patterns are dominant in `Assets/Scripts`?
2. Which parts of the latency scripts are stale or disconnected from the current flow?
3. How can the scripts stay useful without introducing broad cross-project changes?

## Decisions Made
- Use the current project style as reference: public inspector fields, private runtime state, light singleton use, event-style lifecycle cleanup.
- Keep the latency feature in two scripts for now, but make `PipelineTester` thinner and `LatencyEvaluator` the main recorder service.
- Add a dedicated runtime results subfolder under the latency output directory and write one human-readable `.txt` summary per completed interaction.
- Hook the live flow at `VoiceTest` for speech/input timing, `NpcAgent` for response timing/local Piper playback, and `LlmService` for ElevenLabs playback.

## Errors Encountered
- Code review flagged CSV formatting, per-test filename collision risk, and debug-log timestamp issues; all were addressed in the refactor.
- Code review also flagged premature ElevenLabs completion and abandoned-turn lifecycle issues; these were fixed by adding cancellation paths, ElevenLabs playback hooks, and timeout handling.

## Status
**Completed** - Refactor and live pipeline wiring finished, reviewed, and updated with per-test txt result files under the latency results folder.

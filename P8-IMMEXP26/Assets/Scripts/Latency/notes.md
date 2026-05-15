# Notes: Latency script revamp

## Findings

### Existing latency scripts
- `LatencyEvaluator.cs` mixes singleton setup, measurement state, CSV writing, log capture, and debug-log recovery.
- `PipelineTester.cs` contains stale comments and unused STT-specific configuration.
- `PipelineTester.cs` creates `LatencyEvaluator` dynamically, which is uncommon in the rest of the project.

### Codebase conventions
- No namespaces in the inspected scripts.
- Inspector-facing references/config are usually public fields.
- Runtime state is private.
- `Awake` handles singleton/setup, `Start` wires dependencies, `OnDestroy`/`OnDisable` handles cleanup.
- Logging uses bracketed prefixes and sometimes rich text or emojis.

### Current pipeline anchors
- User input currently flows through `VoiceTest.Broadcast()` -> `NpcAgent.Say()`.
- LLM responses are routed through `LlmService.OnMessage()` -> `NpcAgent.OnLlmResponse()`.
- Audio playback is handled in `NpcAgent.GenerateAndPlay()`.

## Refactor direction
- Make `PipelineTester` a thin monitor/controller around an assigned or discovered `LatencyEvaluator`.
- Remove unused STT mode references from `PipelineTester`.
- Align comments and method names with the current flow rather than deprecated architecture.
- Move `Application.logMessageReceived` subscription in `LatencyEvaluator` into explicit lifecycle methods.
- Add small public utilities for clearer monitoring state and statistics export.
- Add one `.txt` summary file per saved measurement inside a results subfolder under the runtime latency output path.

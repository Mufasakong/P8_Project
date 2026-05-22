using UnityEngine;
using System;

/// <summary>
/// Thin latency monitoring helper for the current interview pipeline.
/// Hook these methods from the active flow (for example VoiceTest and NpcAgent) to forward timing events into LatencyEvaluator.
/// </summary>
public class PipelineTester : MonoBehaviour
{
    [Header("Monitoring Settings")]
    public bool startMonitoringOnStart = true;

    [Min(0)]
    public int maxInteractionsToLog = 0;

    [Tooltip("If true, search the scene for a LatencyEvaluator when no reference is assigned.")]
    public bool autoFindEvaluator = true;

    [Tooltip("Allow this helper to trigger debug-log recovery on the evaluator.")]
    public bool enableLogFallback = true;

    [Header("Component References")]
    public LatencyEvaluator latencyEvaluator;

    private bool isMonitoring = false;
    private int interactionCount = 0;
    private int currentResponseTokenCount = 0;

    public bool IsMonitoring => isMonitoring;

    void Start()
    {
        ResolveLatencyEvaluator();

        if (startMonitoringOnStart)
            StartMonitoring();
    }

    private LatencyEvaluator ResolveLatencyEvaluator()
    {
        if (latencyEvaluator != null)
            return latencyEvaluator;

        if (LatencyEvaluator.Instance != null)
        {
            latencyEvaluator = LatencyEvaluator.Instance;
            return latencyEvaluator;
        }

        if (autoFindEvaluator)
            latencyEvaluator = FindObjectOfType<LatencyEvaluator>();

        return latencyEvaluator;
    }

    private bool TryGetEvaluator(out LatencyEvaluator evaluator)
    {
        evaluator = ResolveLatencyEvaluator();

        if (evaluator != null)
            return true;

        Debug.LogWarning("[PipelineTester] No LatencyEvaluator found. Add one to the scene or assign it in the inspector.");
        return false;
    }

    [ContextMenu("Start Monitoring")]
    public void StartMonitoring()
    {
        if (isMonitoring)
        {
            Debug.LogWarning("[PipelineTester] Already monitoring.");
            return;
        }

        if (!TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        isMonitoring = true;
        Debug.Log($"[PipelineTester] ✅ Monitoring enabled. CSV: {evaluator.CsvFilePath}");
    }

    [ContextMenu("Stop Monitoring")]
    public void StopMonitoring()
    {
        if (!isMonitoring)
            return;

        isMonitoring = false;
        Debug.Log("[PipelineTester] ⏹️ Monitoring stopped.");
    }

    [ContextMenu("Analyze Debug Logs")]
    public void RecoverFromDebugLogs()
    {
        if (!enableLogFallback)
        {
            Debug.LogWarning("[PipelineTester] Log fallback is disabled.");
            return;
        }

        if (!TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        Debug.Log("[PipelineTester] 📋 Running debug log analysis...");
        evaluator.AnalyzeDebugLogs();
        evaluator.PrintStatistics();
    }

    [ContextMenu("Print Statistics")]
    public void PrintStatistics()
    {
        if (!TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        evaluator.PrintStatistics();
    }

    [ContextMenu("Cancel Current Interaction")]
    public void CancelCurrentInteraction()
    {
        CancelCurrentInteraction("Canceled by PipelineTester.");
    }

    public void CancelCurrentInteraction(string reason)
    {
        if (!TryGetEvaluator(out LatencyEvaluator evaluator) || !evaluator.IsMeasuring)
            return;

        evaluator.CancelCurrentMeasurement(reason);
        currentResponseTokenCount = 0;
    }

    /// <summary>
    /// Optional hook for the moment a player starts speaking or recording.
    /// Use this from VoiceTest when you want speech-to-submit latency included.
    /// </summary>
    public void OnUserSpeechStarted()
    {
        if (!isMonitoring || !TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        evaluator.MarkSpeechStart();
    }

    /// <summary>
    /// Hook this from VoiceTest when the user's speech completes (i.e. VAD detects silence).
    /// This prevents the STT latency measurement from including the time the user spent talking.
    /// </summary>
    public void OnUserSpeechEnded()
    {
        if (!isMonitoring || !TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        evaluator.MarkSpeechEnd();
    }

    /// <summary>
    /// Hook this from VoiceTest once user text is ready to enter the NPC pipeline.
    /// </summary>
    public void OnUserInputSubmitted(string userText)
    {
        if (!isMonitoring || !TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        evaluator.MarkInputSent();
        Debug.Log($"[PipelineTester] Input submitted: '{BuildPreview(userText)}'");
    }

    /// <summary>
    /// Hook this from NpcAgent.OnLlmResponse or a future streaming callback.
    /// In the current project this marks the first response callback rather than a token-level stream.
    /// </summary>
    public void OnFirstResponseReceived(string responseText)
    {
        OnFirstResponseReceived(responseText, 0);
    }

    public void OnFirstResponseReceived(string responseText, int tokenCountInResponse)
    {
        if (!isMonitoring || !TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        currentResponseTokenCount = Math.Max(0, tokenCountInResponse);
        evaluator.MarkFirstToken();
        Debug.Log($"[PipelineTester] First response received: '{BuildPreview(responseText)}'");
    }

    /// <summary>
    /// Hook this from the audio playback start path in NpcAgent or another TTS handler.
    /// </summary>
    public void OnAudioPlaybackStarted()
    {
        if (!isMonitoring || !TryGetEvaluator(out LatencyEvaluator evaluator))
            return;

        evaluator.MarkFirstAudio();
    }

    /// <summary>
    /// Hook this from the audio playback completion path in NpcAgent or another TTS handler.
    /// </summary>
    public void OnAudioPlaybackEnded(int tokenCountInResponse)
    {
        if (!isMonitoring || !TryGetEvaluator(out LatencyEvaluator evaluator) || !evaluator.IsMeasuring)
            return;

        currentResponseTokenCount = Math.Max(0, tokenCountInResponse);
        evaluator.MarkInteractionEnd(tokenCountInResponse);

        interactionCount++;
        Debug.Log($"[PipelineTester] Interaction #{interactionCount} ended. Tokens: {tokenCountInResponse}");

        if (maxInteractionsToLog > 0 && interactionCount >= maxInteractionsToLog)
            StopMonitoring();

        currentResponseTokenCount = 0;
    }

    public void OnAudioPlaybackEnded()
    {
        OnAudioPlaybackEnded(currentResponseTokenCount);
    }

    // Legacy wrappers kept so existing UnityEvent hookups do not break.
    public void OnUserInputDetected(string userText)
    {
        OnUserInputSubmitted(userText);
    }

    public void OnFirstTokenAppeared(string tokenText)
    {
        OnFirstResponseReceived(tokenText);
    }

    public void OnAllAudioPlaybackEnded(int tokenCountInResponse, double totalAudioDurationMs)
    {
        OnAudioPlaybackEnded(tokenCountInResponse);
    }

    private string BuildPreview(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return "(empty)";

        string trimmed = text.Trim();
        return trimmed.Substring(0, Math.Min(40, trimmed.Length));
    }
}

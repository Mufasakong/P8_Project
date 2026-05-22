using UnityEngine;
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

/// <summary>
/// Records latency measurements for the interview pipeline and writes them to CSV.
/// Primary flow uses explicit hook methods; debug-log recovery is available as a fallback.
/// </summary>
public class LatencyEvaluator : MonoBehaviour
{
    public static LatencyEvaluator Instance { get; private set; }

    private const string CsvSeparator = ";";

    [Header("Output")]
    [Tooltip("Keep this recorder alive across scene loads so one CSV can span a full interview session.")]
    public bool persistAcrossScenes = true;

    [Tooltip("Absolute folder path where latency files should be written.")]
    public string outputDirectoryOverride = @"Assets/Scripts/Latency/Results";

    [Tooltip("Capture relevant Unity logs to a sidecar text file for debugging and recovery.")]
    public bool captureDebugLogs = true;

    [Tooltip("Allow context-menu recovery from the captured debug log file.")]
    public bool enableDebugLogFallback = true;

    [Tooltip("Write one shared text summary file for the full latency test session.")]
    public bool writeSessionTextSummary = true;

    [Tooltip("Optional: also write one separate .txt file for each completed interaction. Usually keep this false to avoid clutter.")]
    public bool writePerTestTextSummary = false;

    [Header("Debug")]
    [Tooltip("Print a short measurement summary whenever a row is saved.")]
    public bool logMeasurementSummary = true;

    [Tooltip("Maximum number of matching log lines kept in memory for quick inspection.")]
    public int maxBufferedLogLines = 200;

    [System.Serializable]
    private class LatencyMeasurement
    {
        public string testId;
        public long timestamp;

        // Timestamps (ticks)
        public long speechStartTick;
        public long speechEndTick;
        public long inputSentTick;
        public long firstTokenTick;
        public long firstAudioTick;
        public long audioEndTick;

        // Metrics (ms)
        public double sttLatencyMs;
        public double ttftMs;
        public double ttfbAudioMs;
        public double e2eLatencyMs;

        public int tokenCount;
        public double tokensPerSec;
        public string source;
    }

    private string outputDirectoryPath;
    private string resultsDirectoryPath;
    private string csvFilePath;
    private string debugLogPath;
    private string summaryFilePath;
    private readonly List<LatencyMeasurement> allMeasurements = new List<LatencyMeasurement>();
    private readonly Queue<string> debugLogBuffer = new Queue<string>();
    private readonly HashSet<string> savedMeasurementIds = new HashSet<string>();

    private LatencyMeasurement currentMeasurement;
    private bool isMeasuring = false;
    private bool outputFilesInitialized = false;
    private bool logSubscriptionActive = false;

    public bool IsMeasuring => isMeasuring;
    public int MeasurementCount => allMeasurements.Count;
    public string OutputDirectoryPath => outputDirectoryPath;
    public string ResultsDirectoryPath => resultsDirectoryPath;
    public string CsvFilePath => csvFilePath;
    public string DebugLogPath => debugLogPath;
    public string SummaryFilePath => summaryFilePath;

    void Awake()
    {
        if (Instance == null)
        {
            Instance = this;

            if (persistAcrossScenes)
                DontDestroyOnLoad(gameObject);

            InitializeOutputFiles();
        }
        else
        {
            Destroy(gameObject);
        }
    }

    void OnEnable()
    {
        SubscribeToLogs();
    }

    void OnDisable()
    {
        UnsubscribeFromLogs();
    }

    private void InitializeOutputFiles()
    {
        if (outputFilesInitialized)
            return;

        outputDirectoryPath = string.IsNullOrWhiteSpace(outputDirectoryOverride)
            ? Path.Combine(Application.persistentDataPath, "Latency")
            : outputDirectoryOverride;

        resultsDirectoryPath = outputDirectoryPath;

        try
        {
            Directory.CreateDirectory(outputDirectoryPath);
            Directory.CreateDirectory(resultsDirectoryPath);
        }
        catch (Exception exception)
        {
            Debug.LogWarning($"[LatencyEvaluator] Failed to use output folder '{outputDirectoryPath}'. Falling back to persistent data path. {exception.Message}");
            outputDirectoryPath = Path.Combine(Application.persistentDataPath, "Latency");
            resultsDirectoryPath = Path.Combine(outputDirectoryPath, "Results");
            Directory.CreateDirectory(outputDirectoryPath);
            Directory.CreateDirectory(resultsDirectoryPath);
        }

        string timestamp = DateTime.Now.ToString("yyyy_MM_dd_HH_mm_ss");
        csvFilePath = Path.Combine(outputDirectoryPath, $"latency_results_{timestamp}.csv");
        debugLogPath = Path.Combine(outputDirectoryPath, $"debug_log_{timestamp}.txt");
        summaryFilePath = Path.Combine(outputDirectoryPath, $"latency_summary_{timestamp}.txt");

        var header = new StringBuilder();
        // The sep=; line tells Excel to split the CSV into clean columns,
        // which is especially useful on systems where comma-separated CSV opens in one cell.
        header.AppendLine("sep=;");
        header.AppendLine("TestID;Timestamp;STT_Latency_ms;TTFT_ms;TTFB_Audio_ms;E2E_Latency_ms;TokenCount;TokensPerSec;Source");
        TryWriteAllText(csvFilePath, header.ToString(), "initialize CSV file");

        if (writeSessionTextSummary)
            WriteSessionSummaryHeader();

        if (captureDebugLogs)
            TryWriteAllText(debugLogPath, "[Debug Log Buffer]\n", "initialize debug log file");

        outputFilesInitialized = true;

        Debug.Log($"[LatencyEvaluator] ✅ Initialized. Results: {csvFilePath}");
        Debug.Log($"[LatencyEvaluator] 📁 Results folder: {resultsDirectoryPath}");
        if (writeSessionTextSummary)
            Debug.Log($"[LatencyEvaluator] 🧾 Summary: {summaryFilePath}");
        if (captureDebugLogs)
            Debug.Log($"[LatencyEvaluator] 📋 Debug logs: {debugLogPath}");
    }

    private void SubscribeToLogs()
    {
        if (!captureDebugLogs || logSubscriptionActive)
            return;

        Application.logMessageReceived += OnLogMessageReceived;
        logSubscriptionActive = true;
    }

    private void UnsubscribeFromLogs()
    {
        if (!logSubscriptionActive)
            return;

        Application.logMessageReceived -= OnLogMessageReceived;
        logSubscriptionActive = false;
    }

    private void OnLogMessageReceived(string logString, string stackTrace, LogType type)
    {
        if (!captureDebugLogs || string.IsNullOrEmpty(debugLogPath) || !ShouldCaptureLog(logString))
            return;

        string timestampedLog = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {logString}";
        debugLogBuffer.Enqueue(timestampedLog);

        while (debugLogBuffer.Count > Mathf.Max(1, maxBufferedLogLines))
            debugLogBuffer.Dequeue();

        TryAppendAllText(debugLogPath, timestampedLog + Environment.NewLine, "append debug log line");
    }

    private bool ShouldCaptureLog(string logString)
    {
        return logString.Contains("[Latency]")
            || logString.Contains("[PipelineTester]")
            || logString.Contains("[Broadcast]")
            || logString.Contains("TTS INPUT")
            || logString.Contains("Playing ElevenLabs audio");
    }

    // --- Public API ---

    public void MarkSpeechStart(string testId = null)
    {
        if (isMeasuring && currentMeasurement != null && currentMeasurement.speechStartTick > 0)
            return;

        currentMeasurement = new LatencyMeasurement();
        currentMeasurement.testId = string.IsNullOrWhiteSpace(testId)
            ? $"Test_{DateTime.Now:HHmmss_fff}"
            : testId;
        currentMeasurement.timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        currentMeasurement.speechStartTick = DateTime.UtcNow.Ticks;
        isMeasuring = true;

        Debug.Log($"[Latency] Measurement started: {currentMeasurement.testId}");
    }

    public void MarkSpeechEnd()
    {
        if (isMeasuring && currentMeasurement != null && currentMeasurement.speechEndTick == 0)
        {
            currentMeasurement.speechEndTick = DateTime.UtcNow.Ticks;
            Debug.Log("[Latency] Speech Ended");
        }
    }

    public void MarkInputSent()
    {
        if (!isMeasuring)
            MarkSpeechStart();

        if (currentMeasurement.inputSentTick == 0)
        {
            currentMeasurement.inputSentTick = DateTime.UtcNow.Ticks;
            Debug.Log("[Latency] Input Sent");
        }
    }

    public void MarkFirstToken()
    {
        if (!isMeasuring || currentMeasurement.firstTokenTick > 0)
            return;

        currentMeasurement.firstTokenTick = DateTime.UtcNow.Ticks;
        currentMeasurement.source = "hook";
        Debug.Log("[Latency] First Token Received");
    }

    public void MarkFirstAudio()
    {
        if (!isMeasuring || currentMeasurement.firstAudioTick > 0)
            return;

        currentMeasurement.firstAudioTick = DateTime.UtcNow.Ticks;
        currentMeasurement.source = "hook";
        Debug.Log("[Latency] First Audio Playback");
    }

    public void MarkInteractionEnd(int tokenCount)
    {
        if (!isMeasuring)
            return;

        currentMeasurement.audioEndTick = DateTime.UtcNow.Ticks;
        currentMeasurement.tokenCount = tokenCount;
        currentMeasurement.source = string.IsNullOrEmpty(currentMeasurement.source) ? "hook" : currentMeasurement.source;

        Debug.Log("[Latency] Audio Playback Completed");

        long freq = TimeSpan.TicksPerMillisecond;

        // Use speechEndTick if available to measure actual STT transcribing time,
        // otherwise it includes the time the user was talking!
        long sttStartTick = currentMeasurement.speechEndTick > 0 ? currentMeasurement.speechEndTick : currentMeasurement.speechStartTick;
        if (currentMeasurement.inputSentTick > sttStartTick)
            currentMeasurement.sttLatencyMs = (currentMeasurement.inputSentTick - sttStartTick) / (double)freq;

        if (currentMeasurement.firstTokenTick > currentMeasurement.inputSentTick)
            currentMeasurement.ttftMs = (currentMeasurement.firstTokenTick - currentMeasurement.inputSentTick) / (double)freq;

        if (currentMeasurement.firstAudioTick > currentMeasurement.inputSentTick)
            currentMeasurement.ttfbAudioMs = (currentMeasurement.firstAudioTick - currentMeasurement.inputSentTick) / (double)freq;

        if (currentMeasurement.audioEndTick > currentMeasurement.inputSentTick)
            currentMeasurement.e2eLatencyMs = (currentMeasurement.audioEndTick - currentMeasurement.inputSentTick) / (double)freq;

        // Generate time for the LLM is from inputSent to firstTokenTick (which acts as the FULL generation here).
        double generationTimeMs = currentMeasurement.ttftMs;

        if (generationTimeMs > 0 && tokenCount > 0)
            currentMeasurement.tokensPerSec = (tokenCount / generationTimeMs) * 1000.0;

        SaveMeasurement(currentMeasurement);
        currentMeasurement = null;
        isMeasuring = false;
    }

    public void CancelCurrentMeasurement(string reason = null)
    {
        if (!isMeasuring)
            return;

        Debug.Log($"[LatencyEvaluator] Measurement canceled: {reason ?? currentMeasurement?.testId ?? "unknown"}");
        currentMeasurement = null;
        isMeasuring = false;
    }

    [ContextMenu("Print Statistics")]
    public void PrintStatistics()
    {
        if (allMeasurements.Count == 0)
        {
            Debug.LogWarning("[LatencyEvaluator] No measurements recorded yet.");
            return;
        }

        double totalStt = 0;
        double totalTtft = 0;
        double totalTtfb = 0;
        double totalE2e = 0;

        foreach (LatencyMeasurement measurement in allMeasurements)
        {
            totalStt += measurement.sttLatencyMs;
            totalTtft += measurement.ttftMs;
            totalTtfb += measurement.ttfbAudioMs;
            totalE2e += measurement.e2eLatencyMs;
        }

        Debug.Log(
            $"[LatencyEvaluator] Measurements={allMeasurements.Count} | " +
            $"Avg STT={totalStt / allMeasurements.Count:F0}ms | " +
            $"Avg TTFT={totalTtft / allMeasurements.Count:F0}ms | " +
            $"Avg TTFB={totalTtfb / allMeasurements.Count:F0}ms | " +
            $"Avg E2E={totalE2e / allMeasurements.Count:F0}ms");
    }

    private void SaveMeasurement(LatencyMeasurement measurement)
    {
        if (measurement == null)
            return;

        InitializeOutputFiles();

        if (string.IsNullOrWhiteSpace(measurement.testId))
            measurement.testId = $"Measurement_{allMeasurements.Count + 1:000}";

        if (!savedMeasurementIds.Add(measurement.testId))
        {
            Debug.LogWarning($"[LatencyEvaluator] Duplicate measurement skipped: {measurement.testId}");
            return;
        }

        if (string.IsNullOrEmpty(measurement.source))
            measurement.source = "hook";

        allMeasurements.Add(measurement);

        TryAppendAllText(csvFilePath, BuildCsvRow(measurement), "append CSV measurement");

        AppendMeasurementToSessionSummary(measurement);
        WriteMeasurementSummaryFile(measurement);

        if (logMeasurementSummary)
        {
            string sourceStr = measurement.source == "hook" ? "🤖" : "📋";
            Debug.Log($"[Latency] {sourceStr} Saved: STT={measurement.sttLatencyMs:F0}ms, TTFT={measurement.ttftMs:F0}ms, TTFB={measurement.ttfbAudioMs:F0}ms, E2E={measurement.e2eLatencyMs:F0}ms");
        }
    }

    private string BuildCsvRow(LatencyMeasurement measurement)
    {
        var sb = new StringBuilder();
        sb.Append(EscapeCsv(measurement.testId)).Append(CsvSeparator);
        sb.Append(measurement.timestamp).Append(CsvSeparator);
        sb.Append(measurement.sttLatencyMs.ToString("F2", CultureInfo.InvariantCulture)).Append(CsvSeparator);
        sb.Append(measurement.ttftMs.ToString("F2", CultureInfo.InvariantCulture)).Append(CsvSeparator);
        sb.Append(measurement.ttfbAudioMs.ToString("F2", CultureInfo.InvariantCulture)).Append(CsvSeparator);
        sb.Append(measurement.e2eLatencyMs.ToString("F2", CultureInfo.InvariantCulture)).Append(CsvSeparator);
        sb.Append(measurement.tokenCount).Append(CsvSeparator);
        sb.Append(measurement.tokensPerSec.ToString("F2", CultureInfo.InvariantCulture)).Append(CsvSeparator);
        sb.AppendLine(EscapeCsv(measurement.source));
        return sb.ToString();
    }

    private void WriteSessionSummaryHeader()
    {
        if (string.IsNullOrEmpty(summaryFilePath))
            return;

        var sb = new StringBuilder();
        sb.AppendLine("Latency Result Summary");
        sb.AppendLine($"Created: {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine();
        sb.AppendLine("Test ID                 | STT (ms) | TTFT (ms) | TTFB (ms) | E2E (ms)");
        sb.AppendLine("------------------------|----------|-----------|-----------|---------");

        TryWriteAllText(summaryFilePath, sb.ToString(), "initialize latency summary file");
    }

    private void AppendMeasurementToSessionSummary(LatencyMeasurement measurement)
    {
        if (!writeSessionTextSummary || measurement == null || string.IsNullOrEmpty(summaryFilePath))
            return;

        string line = string.Format(
            CultureInfo.InvariantCulture,
            "{0,-23} | {1,8:F2} | {2,9:F2} | {3,9:F2} | {4,8:F2}{5}",
            measurement.testId,
            measurement.sttLatencyMs,
            measurement.ttftMs,
            measurement.ttfbAudioMs,
            measurement.e2eLatencyMs,
            Environment.NewLine);

        TryAppendAllText(summaryFilePath, line, "append latency summary measurement");
    }

    private void WriteMeasurementSummaryFile(LatencyMeasurement measurement)
    {
        if (!writePerTestTextSummary || measurement == null || string.IsNullOrEmpty(resultsDirectoryPath))
            return;

        string fileName = $"{SanitizeFileName(measurement.testId)}_{measurement.timestamp}.txt";
        string filePath = Path.Combine(resultsDirectoryPath, fileName);

        var sb = new StringBuilder();
        sb.AppendLine("Latency Test Result");
        sb.AppendLine($"Test ID: {measurement.testId}");
        sb.AppendLine($"Timestamp (unix ms UTC): {measurement.timestamp}");
        sb.AppendLine($"Source: {measurement.source}");
        sb.AppendLine();
        sb.AppendLine($"STT Latency (ms): {measurement.sttLatencyMs.ToString("F2", CultureInfo.InvariantCulture)}");
        sb.AppendLine($"TTFT (ms): {measurement.ttftMs.ToString("F2", CultureInfo.InvariantCulture)}");
        sb.AppendLine($"TTFB Audio (ms): {measurement.ttfbAudioMs.ToString("F2", CultureInfo.InvariantCulture)}");
        sb.AppendLine($"E2E Latency (ms): {measurement.e2eLatencyMs.ToString("F2", CultureInfo.InvariantCulture)}");
        sb.AppendLine($"Token Count: {measurement.tokenCount}");
        sb.AppendLine($"Tokens / sec: {measurement.tokensPerSec.ToString("F2", CultureInfo.InvariantCulture)}");
        sb.AppendLine();
        sb.AppendLine($"CSV File: {csvFilePath}");
        if (captureDebugLogs)
            sb.AppendLine($"Debug Log File: {debugLogPath}");

        TryWriteAllText(filePath, sb.ToString(), "write per-test result file");
    }

    private string SanitizeFileName(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "measurement";

        StringBuilder builder = new StringBuilder(value.Length);
        char[] invalidChars = Path.GetInvalidFileNameChars();

        foreach (char c in value)
        {
            builder.Append(Array.IndexOf(invalidChars, c) >= 0 ? '_' : c);
        }

        return builder.ToString();
    }

    private string EscapeCsv(string value)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;

        bool mustQuote = value.Contains(CsvSeparator) || value.Contains("\"") || value.Contains("\n") || value.Contains("\r");
        string escaped = value.Replace("\"", "\"\"");
        return mustQuote ? $"\"{escaped}\"" : escaped;
    }

    /// <summary>
    /// Fallback: extract measurements from the captured debug log file when hooks miss an interaction.
    /// </summary>
    [ContextMenu("Analyze Debug Logs")]
    public void AnalyzeDebugLogs()
    {
        if (!enableDebugLogFallback)
        {
            Debug.Log("[LatencyEvaluator] Debug log fallback disabled.");
            return;
        }

        Debug.Log("[LatencyEvaluator] 📋 Analyzing debug logs for missed measurements...");

        if (!File.Exists(debugLogPath))
        {
            Debug.LogWarning("[LatencyEvaluator] Debug log file not found!");
            return;
        }

        if (!TryReadAllLines(debugLogPath, out string[] lines))
            return;

        int recovered = 0;

        DateTime? inputSentTime = null;
        DateTime? firstTokenTime = null;
        DateTime? audioPlaybackTime = null;
        DateTime? audioEndTime = null;
        string testId = null;

        foreach (string line in lines)
        {
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith("[Debug Log Buffer]"))
                continue;

            Match timeMatch = Regex.Match(line, @"\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]");
            if (!timeMatch.Success)
                continue;

            string timeStr = timeMatch.Groups[1].Value;
            DateTime time = DateTime.ParseExact(timeStr, "yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);

            if (line.Contains("[Latency] Input Sent"))
            {
                if (inputSentTime.HasValue && firstTokenTime.HasValue)
                {
                    recovered += CreateMeasurementFromLogs(testId, inputSentTime.Value, firstTokenTime.Value, audioPlaybackTime, audioEndTime);
                }

                inputSentTime = time;
                firstTokenTime = null;
                audioPlaybackTime = null;
                audioEndTime = null;
                testId = $"LogRecover_{time:HHmmss_fff}";
            }
            else if (line.Contains("[Latency] First Token Received") && !firstTokenTime.HasValue)
            {
                firstTokenTime = time;
            }
            else if (line.Contains("[Latency] First Audio Playback") && !audioPlaybackTime.HasValue)
            {
                audioPlaybackTime = time;
            }
            else if (line.Contains("[Latency] Audio Playback Completed"))
            {
                audioEndTime = time;
            }
        }

        if (inputSentTime.HasValue && firstTokenTime.HasValue)
            recovered += CreateMeasurementFromLogs(testId, inputSentTime.Value, firstTokenTime.Value, audioPlaybackTime, audioEndTime);

        Debug.Log($"[LatencyEvaluator] ✅ Recovered {recovered} measurements from debug logs");
    }

    private int CreateMeasurementFromLogs(string testId, DateTime inputTime, DateTime tokenTime, DateTime? audioTime, DateTime? endTime)
    {
        var measurement = new LatencyMeasurement()
        {
            testId = testId,
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            source = "log"
        };

        measurement.ttftMs = (tokenTime - inputTime).TotalMilliseconds;

        if (audioTime.HasValue)
            measurement.ttfbAudioMs = (audioTime.Value - inputTime).TotalMilliseconds;

        if (endTime.HasValue)
            measurement.e2eLatencyMs = (endTime.Value - inputTime).TotalMilliseconds;

        measurement.tokenCount = 0;
        measurement.tokensPerSec = 0;

        int beforeCount = allMeasurements.Count;
        SaveMeasurement(measurement);
        return allMeasurements.Count > beforeCount ? 1 : 0;
    }

    private bool TryWriteAllText(string path, string content, string operation)
    {
        try
        {
            File.WriteAllText(path, content, Encoding.UTF8);
            return true;
        }
        catch (IOException exception)
        {
            Debug.LogWarning($"[LatencyEvaluator] Failed to {operation}: {exception.Message}");
            return false;
        }
        catch (UnauthorizedAccessException exception)
        {
            Debug.LogWarning($"[LatencyEvaluator] Failed to {operation}: {exception.Message}");
            return false;
        }
    }

    private bool TryAppendAllText(string path, string content, string operation)
    {
        try
        {
            File.AppendAllText(path, content, Encoding.UTF8);
            return true;
        }
        catch (IOException exception)
        {
            Debug.LogWarning($"[LatencyEvaluator] Failed to {operation}: {exception.Message}");
            return false;
        }
        catch (UnauthorizedAccessException exception)
        {
            Debug.LogWarning($"[LatencyEvaluator] Failed to {operation}: {exception.Message}");
            return false;
        }
    }

    private bool TryReadAllLines(string path, out string[] lines)
    {
        try
        {
            lines = File.ReadAllLines(path);
            return true;
        }
        catch (IOException exception)
        {
            Debug.LogWarning($"[LatencyEvaluator] Failed to read debug log file: {exception.Message}");
        }
        catch (UnauthorizedAccessException exception)
        {
            Debug.LogWarning($"[LatencyEvaluator] Failed to read debug log file: {exception.Message}");
        }

        lines = Array.Empty<string>();
        return false;
    }

    void OnDestroy()
    {
        UnsubscribeFromLogs();

        if (Instance == this)
            Instance = null;
    }
}

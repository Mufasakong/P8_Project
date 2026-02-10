using UnityEngine;
using Whisper;

public class VoiceTest : MonoBehaviour
{
    public WhisperManager whisperManager;
    public LlmManager llmManager;
    private AudioClip _clip;
    private string _micDevice;

    private void Start()
    {
        if (whisperManager == null) whisperManager = GetComponent<WhisperManager>();

        if (Microphone.devices.Length > 0)
        {
            _micDevice = Microphone.devices[0];
            Debug.Log($"Selected Microphone: {_micDevice}");
        }
        else
        {
            Debug.LogError("No Microphone detected!");
        }
    }

    private void Update()
    {
        if (Input.GetKeyDown(KeyCode.Space))
        {
            if (Microphone.IsRecording(_micDevice))
            {
                StopAndTranscribe();
            }
            else
            {
                StartRecording();
            }
        }
    }

    private void StartRecording()
    {
        Debug.Log("Recording... (Press Space to stop)");
        _clip = Microphone.Start(_micDevice, false, 10, 16000);
    }

    private async void StopAndTranscribe()
    {
        int pos = Microphone.GetPosition(_micDevice);
        Microphone.End(_micDevice);
        Debug.Log("Processing...");

        // Send audio to Whisper
        var result = await whisperManager.GetTextAsync(_clip);

        // Print what it heard
        Debug.Log($"<color=green>AI Heard:</color> {result.Result}");
        if (llmManager != null) llmManager.AskAI(result.Result);
    }
}
using UnityEngine;
using UnityEngine.Networking;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using Piper;

public class LlmManager : MonoBehaviour
{
    // CONNECT THE MOUTH HERE
    public PiperManager piperManager;

    // Standard Ollama endpoint
    private string ollamaUrl = "http://localhost:11434/api/generate";

    // Config
    public string modelName = "qwen3:4b-instruct-2507-q4_K_M";
    public bool useStreaming = false;

    // Event to update the UI
    public System.Action<string> OnResponseReceived;

    // We need an AudioSource to play the voice
    private AudioSource audioSource;

    private void Start()
    {
        // Try to find an AudioSource on this object, or create one
        audioSource = GetComponent<AudioSource>();
        if (audioSource == null) audioSource = gameObject.AddComponent<AudioSource>();
    }

    public void AskAI(string userText)
    {
        StartCoroutine(PostRequest(userText));
    }

    IEnumerator PostRequest(string prompt)
    {
        // JSON payload for Ollama
        string json = $"{{\"model\": \"{modelName}\", \"prompt\": \"{prompt}\", \"stream\": {useStreaming.ToString().ToLower()}}}";

        var request = new UnityWebRequest(ollamaUrl, "POST");
        byte[] bodyRaw = Encoding.UTF8.GetBytes(json);
        request.uploadHandler = new UploadHandlerRaw(bodyRaw);
        request.downloadHandler = new DownloadHandlerBuffer();
        request.SetRequestHeader("Content-Type", "application/json");

        // Send and wait
        yield return request.SendWebRequest();

        if (request.result == UnityWebRequest.Result.Success)
        {
            var responseText = request.downloadHandler.text;
            var response = ParseOllamaResponse(responseText);

            Debug.Log($"<color=cyan>AI Said:</color> {response}");
            OnResponseReceived?.Invoke(response);

            // 3. TRIGGER THE VOICE
            if (piperManager != null)
            {
                SpeakResponse(response);
            }
            else
            {
                Debug.LogWarning("PiperManager is not assigned in LlmManager!");
            }
        }
        else
        {
            Debug.LogError("Ollama Error: " + request.error);
        }
    }

    // Helper to call Piper and Play Audio
    private async void SpeakResponse(string text)
    {
        // Ask Piper to generate the clip
        AudioClip voiceClip = await piperManager.TextToSpeech(text);

        if (voiceClip != null)
        {
            audioSource.clip = voiceClip;
            audioSource.Play();
        }
    }

    // Quick helper to get just the text from JSON
    string ParseOllamaResponse(string json)
    {
        // Finds the "response": "..." part
        int responseIndex = json.IndexOf("\"response\":\"");
        if (responseIndex == -1) return json;

        int start = responseIndex + 12;
        int end = json.IndexOf("\",\"done\"", start);

        // Safety check if "done" isn't found
        if (end == -1) end = json.LastIndexOf("\"");

        if (start < json.Length && end > start)
        {
            string clean = json.Substring(start, end - start);
            
            clean = clean.Replace("\\n", "\n").Replace("\\\"", "\"");
            return clean;
        }
        return "Error parsing JSON";
    }
}
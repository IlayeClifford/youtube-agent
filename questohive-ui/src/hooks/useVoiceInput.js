import { useCallback, useRef, useState } from "react";

const MAX_SECONDS = 60;

/**
 * Handles mic recording + transcription. Never sends the result anywhere
 * automatically — it calls `onTranscribed(text)` so the caller can drop it
 * into the composer input for the user to review and edit before sending.
 */
export function useVoiceInput(sttUrl, onTranscribed) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [warning, setWarning] = useState("");

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const autoStoppedRef = useRef(false);

  const cleanup = () => {
    clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    setSeconds(0);
  };

  const start = useCallback(async () => {
    setWarning("");
    if (recording || transcribing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      autoStoppedRef.current = false;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setRecording(false);
        clearInterval(timerRef.current);

        if (autoStoppedRef.current) {
          setWarning("Voice messages are capped at 1 minute — please type this one instead.");
          cleanup();
          return;
        }

        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        cleanup();

        if (blob.size < 800) {
          setWarning("Didn't catch that — try recording again.");
          return;
        }

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("file", blob, "voice.webm");
          const res = await fetch(sttUrl, { method: "POST", body: form });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || "Transcription failed. Try typing instead.");
          }
          const data = await res.json();
          onTranscribed(data.text || "");
        } catch (err) {
          setWarning(err.message || "Couldn't transcribe that. Try typing instead.");
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);

      let elapsed = 0;
      timerRef.current = setInterval(() => {
        elapsed += 1;
        setSeconds(elapsed);
        if (elapsed >= MAX_SECONDS) {
          autoStoppedRef.current = true;
          recorder.stop();
        }
      }, 1000);
    } catch {
      setWarning("Microphone access was blocked or unavailable.");
    }
  }, [recording, transcribing, sttUrl, onTranscribed]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const toggle = useCallback(() => {
    if (recording) stop();
    else start();
  }, [recording, start, stop]);

  return { recording, transcribing, seconds, warning, toggle, dismissWarning: () => setWarning("") };
}
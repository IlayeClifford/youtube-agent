import { useCallback, useRef, useState } from "react";

const MAX_SECONDS = 60;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // reader.result is "data:audio/webm;base64,AAAA..." — strip the prefix.
      const commaIdx = reader.result.indexOf(",");
      resolve(reader.result.slice(commaIdx + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Handles mic recording + transcription. Never sends the result anywhere
 * automatically — it calls `onTranscribed(text)` so the caller can drop it
 * into the composer input for the user to review and edit before sending.
 *
 * `invokeTool` is the helper returned by useAnnaAgentStream — this routes
 * through anna.tools.invoke({tool_id, method: "stt", args: {audio_b64}})
 * instead of a raw fetch() to a separate bridge server, which does not
 * exist when running under `anna-app dev` (or in production — bob_plugin's
 * own handle_stt is the only STT surface now).
 */
export function useVoiceInput(invokeTool, onTranscribed) {
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
          const audio_b64 = await blobToBase64(blob);
          const data = await invokeTool("stt", { audio_b64 });
          onTranscribed(data?.text || "");
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
  }, [recording, transcribing, invokeTool, onTranscribed]);

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
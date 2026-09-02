import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_MS = 5000;
const SILENCE_THRESHOLD = 0.02;
const MAX_RECORD_MS = 90000;
const AUTO_SEND_SECONDS = 5;

const YT_REGEX = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+(?:[&?]t=\d+s?)?)/;

function extractFirstVideo(text) {
  const match = text?.match(YT_REGEX);
  if (!match) return null;
  try {
    const u = new URL(match[0]);
    const id = u.hostname.includes("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v");
    const t = u.searchParams.get("t");
    return id ? { id, start: t ? parseInt(t.replace("s", ""), 10) : 0 } : null;
  } catch {
    return null;
  }
}

/**
 * Owns everything about a Live Call: the WebSocket to /ws/call, mic
 * recording with silence-based auto-stop, the confirm/edit step, the
 * synthesized "thinking" tone, and playback of Bob's TTS reply.
 *
 * `modeId` is read fresh via a ref on every turn, so if the active mode
 * badge is set before the call starts, every turn (not just the first)
 * routes through that mode's agent — same rule as regular chat.
 */
export function useCallSession({ wsUrl, sttUrl, modeId }) {
  const [phase, setPhase] = useState("idle"); // idle | ready | recording | confirming | sending | speaking
  const [micLevel, setMicLevel] = useState(0);
  const [pendingText, setPendingText] = useState("");
  const [countdown, setCountdown] = useState(null);
  const [currentVideo, setCurrentVideo] = useState(null);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");

  const wsRef = useRef(null);
  const modeIdRef = useRef(modeId);
  useEffect(() => {
    modeIdRef.current = modeId;
  }, [modeId]);

  const transcriptRef = useRef([]);

  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(null);
  const lastLoudRef = useRef(0);
  const maxTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const toneStopRef = useRef(null);
  const playingAudioRef = useRef(null);

  const clearRecordingResources = () => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(maxTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  const stopThinkingTone = () => {
    toneStopRef.current?.();
    toneStopRef.current = null;
  };

  const startThinkingTone = () => {
    stopThinkingTone();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 480;
    osc.type = "sine";
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    const pulse = () => {
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    };
    pulse();
    const interval = setInterval(pulse, 900);

    toneStopRef.current = () => {
      clearInterval(interval);
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      ctx.close().catch(() => {});
    };
  };

  const sendTurn = useCallback((text) => {
    if (!text?.trim()) return;
    setPhase("sending");
    setStatusText("Bob is thinking…");
    setError("");
    startThinkingTone();
    transcriptRef.current.push({ role: "user", text });
    wsRef.current?.send(JSON.stringify({ text, mode: modeIdRef.current }));
  }, []);

  const open = useCallback(
    (initialTurn) => {
      setError("");
      setCurrentVideo(null);
      setPendingText("");
      setCountdown(null);
      transcriptRef.current = [];

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (initialTurn) {
          setPhase("sending");
          setStatusText("Bob is thinking…");
          startThinkingTone();
          ws.send(JSON.stringify({ mode: initialTurn.modeId, mode_answers: initialTurn.answers }));
        } else {
          setPhase("ready");
        }
      };

      ws.onmessage = (evt) => {
        const data = JSON.parse(evt.data);

        if (data.type === "user_echo") {
          transcriptRef.current.push({ role: "user", text: data.text });
        }

        if (data.type === "status") {
          setStatusText(data.text);
        }

        if (data.type === "call_reply") {
          stopThinkingTone();
          transcriptRef.current.push({ role: "agent", text: data.text });
          setCurrentVideo(extractFirstVideo(data.text));

          if (data.audio_b64) {
            const audio = new Audio(`data:audio/mp3;base64,${data.audio_b64}`);
            playingAudioRef.current = audio;
            setPhase("speaking");
            audio.onended = () => setPhase("ready");
            audio.onerror = () => setPhase("ready");
            audio.play().catch(() => setPhase("ready"));
          } else {
            setPhase("ready");
          }
        }

        if (data.type === "error") {
          stopThinkingTone();
          setError(data.text);
          setPhase("ready");
        }
      };

      ws.onclose = () => {
        stopThinkingTone();
      };
    },
    [wsUrl]
  );

  const startAutoSendCountdown = (text) => {
    let secs = AUTO_SEND_SECONDS;
    setCountdown(secs);
    clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = setInterval(() => {
      secs -= 1;
      setCountdown(secs);
      if (secs <= 0) {
        clearInterval(countdownTimerRef.current);
        setCountdown(null);
        sendTurn(text);
      }
    }, 1000);
  };

  const beginRecording = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        clearRecordingResources();
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });

        if (blob.size < 800) {
          setPhase("ready");
          return;
        }

        setPhase("confirming");
        try {
          const form = new FormData();
          form.append("file", blob, "call.webm");
          const res = await fetch(sttUrl, { method: "POST", body: form });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail || "Couldn't hear that clearly. Try again.");
          }
          const data = await res.json();
          const text = data.text || "";
          setPendingText(text);
          startAutoSendCountdown(text);
        } catch (err) {
          setError(err.message || "Transcription failed.");
          setPhase("ready");
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      lastLoudRef.current = Date.now();
      setPhase("recording");

      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const level = Math.sqrt(sum / buf.length);
        setMicLevel(level);
        if (level > SILENCE_THRESHOLD) lastLoudRef.current = Date.now();
        if (Date.now() - lastLoudRef.current >= SILENCE_MS) {
          recorder.stop();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      maxTimerRef.current = setTimeout(() => recorder.stop(), MAX_RECORD_MS);
    } catch {
      setError("Microphone access was blocked or unavailable.");
    }
  }, [sttUrl]);

  const stopRecordingManually = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const editPendingText = useCallback((text) => {
    clearInterval(countdownTimerRef.current);
    setCountdown(null);
    setPendingText(text);
  }, []);

  const confirmSend = useCallback(() => {
    clearInterval(countdownTimerRef.current);
    setCountdown(null);
    sendTurn(pendingText);
  }, [pendingText, sendTurn]);

  const hangup = useCallback(() => {
    clearRecordingResources();
    stopThinkingTone();
    clearInterval(countdownTimerRef.current);
    playingAudioRef.current?.pause();
    wsRef.current?.close();
    wsRef.current = null;

    setPhase("idle");
    setPendingText("");
    setCountdown(null);
    setCurrentVideo(null);
    setMicLevel(0);

    const transcript = transcriptRef.current;
    transcriptRef.current = [];
    return transcript;
  }, []);

  return {
    phase,
    micLevel,
    pendingText,
    countdown,
    currentVideo,
    statusText,
    error,
    open,
    beginRecording,
    stopRecordingManually,
    editPendingText,
    confirmSend,
    hangup,
  };
}
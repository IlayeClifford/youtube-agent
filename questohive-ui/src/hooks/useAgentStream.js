import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Owns the WebSocket connection to backend/bridge.py.
 *
 * Message shape: { id, role: "user" | "agent", text, streaming?, status?, runId? }
 *
 * Protocol from the backend:
 *   user_echo   -> a user bubble the frontend didn't type itself (mode-crafted)
 *   start       -> begin a new agent placeholder (streaming, no text yet)
 *   status      -> update the placeholder's status label ("Bob is thinking…")
 *   end         -> fill in the full final text + run_id, streaming = false
 *   error       -> append a plain agent message with the error text
 */
export function useAgentStream(wsUrl) {
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);

      if (data.type === "user_echo") {
        setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: data.text }]);
      }

      if (data.type === "start") {
        setThinking(true);
        setMessages((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, role: "agent", text: "", streaming: true, status: "Bob is thinking…" },
        ]);
      }

      if (data.type === "status") {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "agent" && last.streaming) {
            next[next.length - 1] = { ...last, status: data.text };
          }
          return next;
        });
      }

      if (data.type === "end") {
        setThinking(false);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.streaming) {
            next[next.length - 1] = { ...last, text: data.text, streaming: false, status: undefined, runId: data.run_id || null };
          }
          return next;
        });
      }

      if (data.type === "error") {
        setThinking(false);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.streaming) {
            next[next.length - 1] = { ...last, text: data.text, streaming: false, status: undefined };
            return next;
          }
          return [...next, { id: `err-${Date.now()}`, role: "agent", text: data.text }];
        });
      }
    };

    wsRef.current = ws;
    return () => ws.close();
  }, [wsUrl]);

  const send = useCallback((text, modeId) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
    const payload = modeId ? { text, mode: modeId } : { text };
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  const sendMode = useCallback((modeId, answers) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ mode: modeId, mode_answers: answers }));
  }, []);

  const appendLocalMessages = useCallback((newMsgs) => {
    setMessages((prev) => [...prev, ...newMsgs]);
  }, []);

  return { messages, thinking, connected, send, sendMode, appendLocalMessages };
}
import { useCallback, useEffect, useRef, useState } from "react";

const TOOL_ID = "tool-dev-my-first-anna-app";

// Job deadline, not a network timeout — comfortably above Bob's own ~150s
// average tool-calling latency, nowhere near the 60s..24h bounds Anna
// enforces. This is what replaces the 90-second tools.invoke ceiling.
const CHAT_TIMEOUT_MS = 5 * 60 * 1000;

// Plain tools.invoke ceiling per host-api-tools.md — the public edge's
// held-request max is 90s regardless of what we pass. stt/tts/feedback are
// all well under that, so they stay on tools.invoke rather than the async
// job channel chat uses.
const SYNC_TOOL_TIMEOUT_MS = 30 * 1000;

// How long we keep quietly polling for the real result after the client's
// own invokeAsyncAwait gives up early (wait_timeout). The job itself is
// almost always still healthy at this point — confirmed empirically: a
// plain "Hi" hit wait_timeout on first send, then answered instantly on
// resend, meaning the first job had already succeeded server-side by the
// time the client stopped watching it. clientTag is what lets us re-find
// that same job instead of abandoning it. Bounded well under CHAT_TIMEOUT_MS
// so we never wait past the job's real deadline.
const RECOVERY_WINDOW_MS = 9000 * 1000;
const RECOVERY_POLL_MS = 40000;
const CLIENT_TAG = "bob-chat";

// Maps the documented invokeAsyncAwait error codes to something worth
// actually showing a user, instead of a raw error code.
function friendlyAsyncError(err) {
  switch (err?.code) {
    case "cancelled":
      return "Cancelled.";
    case "tool_timeout":
      return "That took too long and hit its time limit — try a narrower question.";
    case "tool_failed":
      return "Something went wrong on Bob's end. Try again.";
    case "wait_timeout":
      return "Lost track waiting for that one — it may still be running. Try again in a moment.";
    case "job_quota_exceeded":
      return "You've got a few things running already — wait for one to finish first.";
    case "long_job_capacity":
      return "Bob's a little busy right now — try again in a few seconds.";
    default:
      return `Something went wrong: ${err?.message || err?.code || "unknown error"}`;
  }
}

/**
 * Owns the connection to Bob's Executa via the Anna App SDK. Replaces the
 * old WebSocket-based useAgentStream — same external shape (messages,
 * thinking, connected, send, sendMode, appendLocalMessages) so App.jsx
 * doesn't need to change how it consumes this hook for chat.
 *
 * Also exposes `invokeTool(method, args)` — a thin wrapper over plain
 * anna.tools.invoke, for the plugin's synchronous methods (stt, tts,
 * feedback) that previously bypassed the Anna SDK entirely and hit a
 * hardcoded-IP bridge server directly. Anything calling this must handle
 * the plugin's own {success, data, error} envelope — invokeTool returns
 * that payload as-is (already unwrapped from the two SDK/host envelope
 * layers), it does not further unwrap `success`.
 */
export function useAnnaAgentStream() {
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const annaRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { AnnaAppRuntime } = await import(
          /* @vite-ignore */ "/static/anna-apps/_sdk/latest/index.js"
        );
        const anna = await AnnaAppRuntime.connect();
        if (cancelled) return;
        annaRef.current = anna;
        setConnected(true);
      } catch (e) {
        console.error("Anna connect failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateStreamingMessage = useCallback((patch) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.streaming) next[next.length - 1] = { ...last, ...patch };
      return next;
    });
  }, []);

  const runChat = useCallback(
    async (args) => {
      if (!annaRef.current) return;
      setThinking(true);
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "agent", text: "", streaming: true, status: "Bob is thinking…" },
      ]);

      const ctl = new AbortController();

      // Shared "we have a real result" path — used whether it came back
      // normally or was recovered after a wait_timeout.
      const applyResult = (result) => {
        const text = result?.text || "";
        const userText = result?.user_text || null;

        setMessages((prev) => {
          let next = [...prev];
          if (userText) {
            // Mode-crafted first message — the user never typed it, so we
            // only learn what was actually sent once the reply comes back.
            next.splice(next.length - 1, 0, { id: `u-${Date.now()}`, role: "user", text: userText });
          }
          const last = next[next.length - 1];
          if (last?.streaming) {
            next[next.length - 1] = { ...last, text, streaming: false, status: undefined };
          }
          return next;
        });
      };

      // Called only when invokeAsyncAwait gives up early (wait_timeout).
      // The job is almost always still fine server-side — this re-finds it
      // via clientTag and keeps polling getJob, instead of immediately
      // showing the user an error for a request that's actually going to
      // succeed a few seconds later.
      const tryRecoverJob = async () => {
        const anna = annaRef.current;
        if (!anna) return null;
        updateStreamingMessage({ status: "Still working on it — hang tight…" });

        const deadline = Date.now() + RECOVERY_WINDOW_MS;
        let jobId = null;

        while (Date.now() < deadline) {
          try {
            if (!jobId) {
              const { jobs } = await anna.tools.listJobs({ clientTag: CLIENT_TAG, limit: 5 });
              const candidate = jobs?.find(
                (j) => j.state === "running" || j.state === "queued" || j.state === "succeeded"
              );
              if (candidate) jobId = candidate.jobId;
            }
            if (jobId) {
              const snap = await anna.tools.getJob({ jobId });
              if (snap.state === "succeeded") return snap.result;
              if (["failed", "cancelled", "expired"].includes(snap.state)) {
                throw new Error(snap.error?.message || `Job ended: ${snap.state}`);
              }
            }
          } catch {
            // keep trying until the recovery window runs out
          }
          await new Promise((r) => setTimeout(r, RECOVERY_POLL_MS));
        }
        return null; // genuinely gone — fall through to the normal error message
      };

      try {
        const result = await annaRef.current.tools.invokeAsyncAwait(
          {
            tool_id: TOOL_ID,
            method: "chat",
            args,
            timeoutMs: CHAT_TIMEOUT_MS,
            clientTag: CLIENT_TAG,
          },
          {
            onProgress: (ev) => {
              const data = ev?.data;
              if (data?.type === "status" && data.text) {
                updateStreamingMessage({ status: data.text });
              }
            },
            signal: ctl.signal,
          }
        );

        // Same unwrapping as plain tools.invoke — `result` IS the plugin's
        // `data` payload already, not `result.data`.
        applyResult(result);
      } catch (err) {
        if (err?.code === "wait_timeout") {
          const recovered = await tryRecoverJob();
          if (recovered) {
            applyResult(recovered);
            setThinking(false);
            return;
          }
        }
        updateStreamingMessage({ text: friendlyAsyncError(err), streaming: false, status: undefined });
      } finally {
        setThinking(false);
      }
    },
    [updateStreamingMessage]
  );

  const send = useCallback(
    (text, modeId) => {
      if (!text.trim()) return;
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text }]);
      runChat({ text, mode: modeId });
    },
    [runChat]
  );

  const sendMode = useCallback(
    (modeId, answers) => {
      runChat({ mode: modeId, mode_answers: answers });
    },
    [runChat]
  );

  const appendLocalMessages = useCallback((newMsgs) => {
    setMessages((prev) => [...prev, ...newMsgs]);
  }, []);

  // Generic sync tool call — used by stt / tts / feedback instead of the
  // old raw fetch() calls to a separate bridge server. Throws on failure
  // (invalid_arg, tool_timeout, agent_unavailable, permission_denied, or
  // the plugin's own {success:false, error} surfaced as a message) so
  // callers can catch/report however fits their UI.
  const invokeTool = useCallback(async (method, args, opts = {}) => {
    if (!annaRef.current) {
      throw new Error("Not connected to Bob yet — try again in a moment.");
    }
    const result = await annaRef.current.tools.invoke(
      {
        tool_id: TOOL_ID,
        method,
        args,
        timeoutMs: opts.timeoutMs || SYNC_TOOL_TIMEOUT_MS,
      },
      { timeoutMs: opts.timeoutMs || SYNC_TOOL_TIMEOUT_MS }
    );
    // The plugin's own handlers return {success, data, error} inside the
    // already-unwrapped payload — surface plugin-level failures the same
    // way as transport-level ones so callers only need one catch path.
    if (result && result.success === false) {
      throw new Error(result.error || `${method} failed.`);
    }
    return result?.data ?? result;
  }, []);

  return { messages, thinking, connected, send, sendMode, appendLocalMessages, invokeTool };
}
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Youtube, Clock, Sparkles, ArrowUp, Square, Mic, Loader2, AlertCircle, PanelRightOpen, Play, Wand2, Volume2, ThumbsUp, ThumbsDown, HelpCircle } from "lucide-react";
import { C } from "./lib/theme";
import { MODES_META, MODE_ORDER } from "./lib/modes";
import { FACTS } from "./lib/facts";
import { extractVideos, stripVideoUrls, dedupeVideos, fmtTime } from "./lib/youtube";
import { useAnnaAgentStream } from "./hooks/useAnnaAgentStream";
import { useVoiceInput } from "./hooks/useVoiceInput";
import ModesOverlay from "./components/ModesOverlay";

// NOTE: the old WS_URL / STT_URL / TTS_URL / FEEDBACK_URL / FEEDBACK_TEXT_URL
// constants (pointing at a hardcoded-IP bridge server) are gone. Every call
// that used to hit that bridge now goes through `invokeTool`, the Anna SDK
// wrapper returned by useAnnaAgentStream — see AudioPlayButton,
// FeedbackButtons, FeedbackModal, and the useVoiceInput() call inside App().

const MOCK_CHUNKS = {};
const COMPOSER_MAX_WIDTH = 960;
const TEXTAREA_MAX_HEIGHT = 200;

// --- Font sizes — adjust these to taste ------------------------------------
// Only affects phones; desktop's sizes are set separately in the desktop
// bubble/textarea below and are untouched by these.
const MOBILE_MESSAGE_FONT_SIZE = "15px";
const MOBILE_INPUT_FONT_SIZE = "16px";

// Matches MAX_MESSAGE_CHARS in bridge.py — the textarea's maxLength stops
// most people before they'd ever hit the backend's rejection.
const MAX_MESSAGE_CHARS = 2000;

const TOOL_CALL_EDGE_MS = 150000;
const STATUS_CADENCE_MS = 5000;
const FACT_ROTATE_MS = 5000;

const SUGGESTION_POOL = [
  "Summarize this video",
  "Find the part about pricing",
  "Explain that in simpler terms",
  "Find a video on this topic",
  "What's the key takeaway?",
  "Jump to the demo section",
];

function pickThree(exclude = []) {
  const pool = SUGGESTION_POOL.filter((s) => !exclude.includes(s));
  return [...pool].sort(() => Math.random() - 0.5).slice(0, 3);
}

const markdownComponents = {
  p: (props) => <p className="mb-2 leading-relaxed last:mb-0" {...props} />,
  strong: (props) => <strong style={{ color: C.text, fontWeight: 700 }} {...props} />,
  em: (props) => <em {...props} />,
  ul: (props) => <ul className="my-1.5 ml-4 list-disc space-y-1" {...props} />,
  ol: (props) => <ol className="my-1.5 ml-4 list-decimal space-y-1" {...props} />,
  li: (props) => <li {...props} />,
  h1: (props) => <p className="mb-1 mt-2 text-[15px] font-semibold first:mt-0" style={{ color: C.text }} {...props} />,
  h2: (props) => <p className="mb-1 mt-2 text-[15px] font-semibold first:mt-0" style={{ color: C.text }} {...props} />,
  h3: (props) => <p className="mb-1 mt-2 text-[14px] font-semibold first:mt-0" style={{ color: C.text }} {...props} />,
  a: (props) => <a style={{ color: C.cyan }} target="_blank" rel="noreferrer" {...props} />,
  code: (props) => (
    <code style={{ background: C.panelAlt, padding: "1px 5px", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.85em" }} {...props} />
  ),
};

function Avatar({ role }) {
  const isAgent = role === "agent";
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{ background: isAgent ? C.cyanDim : C.panelAlt, color: isAgent ? C.cyan : C.muted, border: `1px solid ${C.border}`, fontFamily: "'Space Grotesk', sans-serif" }}
    >
      {isAgent ? "B" : "Y"}
    </div>
  );
}

function TimestampPills({ video, activeIndex, onSeek }) {
  const chunks = MOCK_CHUNKS[video.id] || [];
  if (!chunks.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {chunks.map((c, i) => {
        const active = i === activeIndex;
        return (
          <button
            key={i}
            onClick={() => onSeek(video, c, i)}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all"
            style={{ background: active ? C.red : "transparent", color: active ? "#FFFFFF" : C.muted, border: `1px solid ${active ? C.red : C.border}`, fontFamily: "'JetBrains Mono', monospace" }}
          >
            <Clock size={11} />
            {fmtTime(c.start)}
            <span className="hidden sm:inline" style={{ color: active ? "#FFFFFF" : C.mutedDark }}>
              · {c.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// `video.short` (set in lib/youtube.js) switches between a normal 16:9
// embed and a vertical 9:16 one for youtube.com/shorts/ links.
function VideoCard({ video }) {
  const iframeRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const seek = useCallback((v, chunk, idx) => {
    setActiveIndex(idx);
    const win = iframeRef.current?.contentWindow;
    if (win) win.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [chunk.start, true] }), "*");
  }, []);

  return (
    <div className="overflow-hidden rounded-xl" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div
        className="relative w-full mx-auto"
        style={{ background: "#000", aspectRatio: video.short ? "9 / 16" : "16 / 9", maxWidth: video.short ? 280 : "none" }}
      >
        <div className="absolute inset-0 overflow-hidden transition-opacity duration-500" style={{ opacity: loaded ? 0 : 1, pointerEvents: loaded ? "none" : "auto" }}>
          <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${C.panel} 0%, ${C.panelAlt} 50%, ${C.panel} 100%)`, backgroundSize: "200% 100%", animation: "shimmer 1.6s ease-in-out infinite" }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <Youtube size={22} style={{ color: C.mutedDark }} />
          </div>
        </div>
        <iframe
          ref={iframeRef}
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${video.id}?enablejsapi=1&rel=0&modestbranding=1&start=${video.start}`}
          title="YouTube video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <Youtube size={14} style={{ color: C.red }} />
          <span className="text-xs" style={{ color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}>
            {video.id}
            {video.short ? " · Short" : ""}
          </span>
        </div>
        <TimestampPills video={video} activeIndex={activeIndex} onSeek={seek} />
      </div>
    </div>
  );
}

// Mobile only — every video Bob cites in a reply renders here, stacked
// vertically, no cap, no horizontal scrolling. Bob's full response text
// stays intact above this (no longer split mid-list), each video gets its
// timestamp label if it has one.
function MobileVideoStack({ videos }) {
  if (!videos.length) return null;
  return (
    <div className="mt-2 space-y-3 lg:hidden">
      {videos.map((v) => (
        <div key={v.url}>
          {v.start > 0 && (
            <div className="mb-1 flex items-center gap-1 text-[11px]" style={{ color: C.cyan }}>
              <Clock size={10} /> Bob means this part — {fmtTime(v.start)}
            </div>
          )}
          <VideoCard video={v} />
        </div>
      ))}
    </div>
  );
}

// invokeTool is the Anna SDK wrapper from useAnnaAgentStream — replaces the
// old fetch(FEEDBACK_URL) call to the retired bridge server.
function FeedbackButtons({ runId, invokeTool }) {
  const [rated, setRated] = useState(null); // null | "up" | "down"

  if (!runId) return null;

  const rate = async (score, label) => {
    if (rated) return; // one rating per message
    setRated(label);
    try {
      await invokeTool("feedback", { text: `rating:${label} run_id:${runId}` });
    } catch {
      // A rating silently failing to save isn't worth interrupting the user over.
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => rate(1, "up")}
        disabled={!!rated}
        className="flex h-6 w-6 items-center justify-center rounded-full transition-colors"
        style={{ background: C.panelAlt, color: rated === "up" ? C.cyan : C.muted, border: `1px solid ${C.border}` }}
        title="Good response"
      >
        <ThumbsUp size={11} />
      </button>
      <button
        onClick={() => rate(0, "down")}
        disabled={!!rated}
        className="flex h-6 w-6 items-center justify-center rounded-full transition-colors"
        style={{ background: C.panelAlt, color: rated === "down" ? C.red : C.muted, border: `1px solid ${C.border}` }}
        title="Bad response"
      >
        <ThumbsDown size={11} />
      </button>
    </div>
  );
}

// Small speaker button on each finished agent reply — generates TTS on tap
// and plays it. Nothing plays automatically; this is opt-in per message.
// invokeTool replaces the old fetch(TTS_URL) call to the retired bridge.
function AudioPlayButton({ text, invokeTool }) {
  const [state, setState] = useState("idle"); // idle | loading | playing
  const audioRef = useRef(null);

  const handleClick = async () => {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const data = await invokeTool("tts", { text });
      if (!data?.audio_b64) throw new Error("no audio");
      const audio = new Audio(`data:audio/mp3;base64,${data.audio_b64}`);
      audioRef.current = audio;
      audio.onended = () => setState("idle");
      audio.onerror = () => setState("idle");
      setState("playing");
      audio.play().catch(() => setState("idle"));
    } catch {
      setState("idle");
    }
  };

  return (
    <button
      onClick={handleClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors"
      style={{ background: C.panelAlt, color: C.muted, border: `1px solid ${C.border}` }}
      title={state === "playing" ? "Stop" : "Play as audio"}
    >
      {state === "loading" ? <Loader2 size={11} className="animate-spin" /> : state === "playing" ? <Square size={9} /> : <Volume2 size={11} />}
    </button>
  );
}

function MessageBubble({ msg, registerVideoNode, invokeTool }) {
  const isAgent = msg.role === "agent";
  const cleanText = stripVideoUrls(msg.text);
  const videos = useMemo(() => dedupeVideos(extractVideos(msg.text)), [msg.text]);
  const hasVideo = !msg.streaming && videos.length > 0;

  const bubbleStyle = {
    background: isAgent ? C.panel : C.cyanDim,
    border: `1px solid ${isAgent ? C.border : "transparent"}`,
    color: C.text,
    borderTopLeftRadius: isAgent ? 4 : undefined,
    borderTopRightRadius: !isAgent ? 4 : undefined,
  };

  return (
    <div ref={hasVideo ? (node) => registerVideoNode(msg.id, node) : undefined} className="flex flex-col gap-1.5">
      {/* Mobile only: avatar + role label sits above the bubble instead of
          beside it, freeing horizontal width for the message itself. */}
      <div className={`flex items-center gap-2 lg:hidden ${isAgent ? "" : "flex-row-reverse"}`}>
        <Avatar role={msg.role} />
        <span className="text-[11px]" style={{ color: C.muted }}>
          {isAgent ? "Bob" : "You"}
        </span>
      </div>

      <div className={`flex gap-3 ${isAgent ? "" : "flex-row-reverse"}`}>
        <div className="hidden lg:block">
          <Avatar role={msg.role} />
        </div>
        <div className={`max-w-full lg:max-w-[80%] ${isAgent ? "" : "flex flex-col items-end"}`}>
          {/* Desktop — unchanged: plain text, sidebar handles videos */}
          <div className="hidden rounded-2xl px-4 py-2.5 text-[14px] lg:block" style={bubbleStyle}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {cleanText}
            </ReactMarkdown>
          </div>

          {/* Mobile — Bob's response stays intact (lists, numbering, all of
              it), same as desktop, just at the mobile font size */}
          <div className="rounded-2xl px-4 py-2.5 lg:hidden" style={{ ...bubbleStyle, fontSize: MOBILE_MESSAGE_FONT_SIZE }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {cleanText}
            </ReactMarkdown>
          </div>

          {isAgent && !msg.streaming && cleanText && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <AudioPlayButton text={cleanText} invokeTool={invokeTool} />
              <FeedbackButtons runId={msg.runId} invokeTool={invokeTool} />
            </div>
          )}

          {/* Mobile — only the non-timestamped links land here now */}
          <MobileVideoStack videos={videos} />
        </div>
      </div>
    </div>
  );
}

function WatchPanel({ videos, open, onClose }) {
  return (
    <div className="hidden shrink-0 overflow-hidden transition-all duration-500 ease-out lg:flex" style={{ width: open ? "50%" : "0%", borderLeft: open ? `1px solid ${C.border}` : "none" }}>
      <div className="flex h-full w-full flex-col" style={{ minWidth: 420 }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2">
            <Youtube size={16} style={{ color: C.red }} />
            <span className="text-sm font-semibold tracking-wide" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
              Watch
            </span>
            <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: C.redDim, color: C.red, fontFamily: "'JetBrains Mono', monospace" }}>
              {videos.length}
            </span>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5" style={{ color: C.muted }} title="Close sidebar">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {videos.map((v) => (
            <VideoCard key={v.url} video={v} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Floating, draggable Videos trigger — mobile only. Defaults to bottom-left;
// dragging is session-only (resets to default on reload, nothing persisted).
// Pointer events cover touch and mouse in one code path. A small movement
// threshold distinguishes a tap (opens the list) from a drag (repositions).
function DraggableVideosButton({ count, onOpen }) {
  const [pos, setPos] = useState(null);
  const dragState = useRef({ dragging: false, moved: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  useEffect(() => {
    setPos({ x: 16, y: window.innerHeight - 92 });
  }, []);

  if (!pos) return null;

  const clamp = (x, y) => ({
    x: Math.min(Math.max(x, 8), window.innerWidth - 64),
    y: Math.min(Math.max(y, 8), window.innerHeight - 64),
  });

  const onPointerDown = (e) => {
    dragState.current = { dragging: true, moved: false, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const s = dragState.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) s.moved = true;
    setPos(clamp(s.origX + dx, s.origY + dy));
  };

  const onPointerUp = () => {
    const s = dragState.current;
    s.dragging = false;
    if (!s.moved) onOpen();
  };

  return (
    <button
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="fixed z-30 flex h-14 w-14 touch-none items-center justify-center rounded-full shadow-2xl lg:hidden"
      style={{ left: pos.x, top: pos.y, background: C.red, color: "#fff" }}
      title="Videos — drag to move, tap to open"
    >
      <Youtube size={22} />
      <span
        className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
        style={{ background: "#fff", color: C.red }}
      >
        {count}
      </span>
    </button>
  );
}

// Written deliberately without invented specific percentages — if you have
// real numbers from actual usage later, swap them in here.
const CAPABILITIES = [
  { icon: "🔍", title: "Find exactly what you're looking for", body: "Describe what you want in plain English — Bob searches YouTube for you, so you skip the clickbait titles and ad-disguised-as-content results cluttering a normal search." },
  { icon: "⏱️", title: "Know if a video's worth your time, first", body: "Tell Bob your requirements — length, depth, what you actually need — before committing 40 minutes to something that might not deliver." },
  { icon: "🎯", title: "Jump straight to the moment that matters", body: "Ask Bob to find exactly where something was said in a video, instead of scrubbing back and forth yourself." },
  { icon: "📋", title: "Get the key points without watching the whole thing", body: "Bob can summarize a video, or compare a few on the same topic side by side, so you know what's actually in each one." },
  { icon: "🎛️", title: "Nine guided modes for common needs", body: "From Sermons to Business & Finance to Entertainment — each mode asks the right questions upfront, so the first result is sharp instead of generic." },
  { icon: "🎙️", title: "Talk instead of type", body: "Record a voice message instead of typing, and have Bob's replies read back to you." },
];

function CapabilitiesOverlay({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: C.bg }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="text-sm font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
          What Bob can do
        </span>
        <button onClick={onClose} className="rounded-full p-2" style={{ background: C.panelAlt, color: C.muted }}>
          <X size={16} />
        </button>
      </div>
      <div className="mx-auto w-full max-w-lg flex-1 space-y-5 overflow-y-auto px-5 py-6">
        {CAPABILITIES.map((c, i) => (
          <div key={i} className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl" style={{ background: C.panelAlt }}>
              {c.icon}
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: C.text }}>
                {c.title}
              </div>
              <div className="mt-0.5 text-sm" style={{ color: C.muted }}>
                {c.body}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// invokeTool replaces the old fetch(FEEDBACK_TEXT_URL) call to the retired
// bridge server.
function FeedbackModal({ open, onClose, invokeTool }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error

  if (!open) return null;

  const submit = async () => {
    if (!text.trim()) return;
    setStatus("sending");
    try {
      await invokeTool("feedback", { text });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: C.bg, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
            Tell us what's wrong (or right)
          </span>
          <button onClick={onClose} style={{ color: C.muted }}>
            <X size={16} />
          </button>
        </div>
        {status === "sent" ? (
          <div className="py-4 text-center text-sm" style={{ color: C.cyan }}>
            Thanks — got it. 🙏
          </div>
        ) : (
          <>
            <textarea
              autoFocus
              rows={4}
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's broken, confusing, or could be better?"
              className="w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
            />
            {status === "error" && (
              <div className="mt-2 text-xs" style={{ color: C.red }}>
                Couldn't send that — try again.
              </div>
            )}
            <button
              onClick={submit}
              disabled={status === "sending" || !text.trim()}
              className="mt-3 w-full rounded-full py-2.5 text-sm font-semibold"
              style={{ background: C.cyan, color: "#08131A", opacity: status === "sending" ? 0.7 : 1 }}
            >
              {status === "sending" ? "Sending…" : "Send feedback"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MobileVideosOverlay({ open, videos, onClose }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col lg:hidden" style={{ background: C.bg }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
        <span className="text-sm font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
          Videos ({videos.length})
        </span>
        <button onClick={onClose} className="rounded-full p-2" style={{ background: C.panelAlt, color: C.muted }}>
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {videos.map((v) => (
          <VideoCard key={v.url} video={v} />
        ))}
      </div>
    </div>
  );
}

function DesktopMiniPlayer({ video, onOpen }) {
  if (!video) return null;
  return (
    <button onClick={onOpen} className="fixed bottom-6 right-6 z-30 hidden items-center gap-3 overflow-hidden rounded-xl pr-4 shadow-2xl transition-transform hover:scale-[1.02] lg:flex" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
      <div className="relative h-14 w-24 shrink-0" style={{ background: "#000" }}>
        <img src={`https://img.youtube.com/vi/${video.id}/mqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-80" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: C.red }}>
            <Play size={11} fill="#fff" color="#fff" />
          </div>
        </div>
      </div>
      <div className="py-2 text-left">
        <div className="text-xs font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
          Video ready
        </div>
        <div className="text-[11px]" style={{ color: C.muted }}>
          Tap to reopen
        </div>
      </div>
    </button>
  );
}

function BrandMark({ size = 88 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF5B52" />
          <stop offset="100%" stopColor="#C62A22" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="88" height="88" rx="24" fill="url(#brandGrad)" />
      <path d="M39 31L66 48L39 65V31Z" fill="#FFFFFF" />
    </svg>
  );
}

function EmptyState({ onPick }) {
  const [chips, setChips] = useState(() => pickThree());
  useEffect(() => {
    const id = setInterval(() => setChips((prev) => pickThree(prev)), 4000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div style={{ filter: `drop-shadow(0 0 48px ${C.red}4D)` }}>
        <BrandMark />
      </div>
      <div>
        <div className="text-lg font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
          Ask Bob anything
        </div>
        <div className="mx-auto mt-1.5 max-w-xs text-sm" style={{ color: C.muted }}>
          Search, summarize, or jump straight to the moment you need in any YouTube video.
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-2" key={chips.join()}>
        {chips.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="rounded-full px-3 py-1.5 text-xs transition-colors" style={{ background: C.panelAlt, color: C.muted, border: `1px solid ${C.border}` }}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function isToolPhase(status) {
  return Boolean(status) && status !== "Bob is thinking…" && status !== "Bob is perfecting it…";
}

function FactBubble({ index, visible }) {
  return (
    <div
      className="relative mb-1.5 ml-11 max-w-xs rounded-xl px-3 py-2 text-xs transition-opacity duration-300"
      style={{ background: C.panelAlt, color: C.muted, border: `1px solid ${C.border}`, opacity: visible ? 1 : 0 }}
    >
      {FACTS[index % FACTS.length]}
      <div className="absolute -bottom-[7px] left-6 h-3 w-3 rotate-45" style={{ background: C.panelAlt, borderRight: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }} />
    </div>
  );
}

function TypingIndicator({ status }) {
  const toolPhase = isToolPhase(status);
  const startRef = useRef(null);
  const [percent, setPercent] = useState(0);
  const [showPercent, setShowPercent] = useState(false);
  const [factIndex, setFactIndex] = useState(() => Math.floor(Math.random() * FACTS.length));
  const [factVisible, setFactVisible] = useState(true);

  useEffect(() => {
    if (!toolPhase) {
      startRef.current = null;
      setShowPercent(false);
      return;
    }
    if (!startRef.current) startRef.current = Date.now();

    const percentTimer = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setPercent(Math.min(98, Math.round((elapsed / TOOL_CALL_EDGE_MS) * 100)));
    }, 1000);
    const cadenceTimer = setInterval(() => setShowPercent((v) => !v), STATUS_CADENCE_MS);
    const factTimer = setInterval(() => {
      setFactVisible(false);
      setTimeout(() => {
        setFactIndex((prev) => {
          if (FACTS.length <= 1) return 0;
          let next = prev;
          while (next === prev) {
            next = Math.floor(Math.random() * FACTS.length);
          }
          return next;
        });
        setFactVisible(true);
      }, 300);
    }, FACT_ROTATE_MS);

    return () => {
      clearInterval(percentTimer);
      clearInterval(cadenceTimer);
      clearInterval(factTimer);
    };
  }, [toolPhase]);

  const displayStatus = toolPhase && showPercent ? `Bob is ${percent}% there` : status;

  return (
    <div className="flex flex-col">
      {toolPhase && <FactBubble index={factIndex} visible={factVisible} />}
      <div className="flex gap-3">
        <Avatar role="agent" />
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: C.panel, border: `1px solid ${C.border}`, borderTopLeftRadius: 4 }}>
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: C.cyan, animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
          {displayStatus && (
            <span className="text-xs" style={{ color: C.muted }}>
              {displayStatus}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MicWaveform() {
  return (
    <div className="flex items-center gap-[3px]">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="w-[3px] rounded-full" style={{ background: C.red, height: 10, animation: "waveform 0.9s ease-in-out infinite", animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  );
}

// Hidden on mobile — the subtle grain texture was showing up as a visible
// blotchy artifact on some mobile renderers instead of the intended subtle
// sheen. Desktop keeps it.
function GrainOverlay() {
  return (
    <svg className="hidden lg:block" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", opacity: 0.035, pointerEvents: "none", mixBlendMode: "overlay", zIndex: 40 }}>
      <filter id="grainFilter">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grainFilter)" />
    </svg>
  );
}

function ModesButton({ activeMode, onOpen, onClear }) {
  if (activeMode) {
    return (
      <button onClick={onOpen} className="flex items-center gap-2 rounded-full py-2 pl-4 pr-2 text-sm font-medium" style={{ background: `${activeMode.glow}22`, color: activeMode.glow, border: `1px solid ${activeMode.glow}55` }} title="Switch mode">
        <span>{activeMode.emoji}</span>
        {activeMode.label}
        <span
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="ml-1 flex h-5 w-5 items-center justify-center rounded-full"
          style={{ background: "rgba(255,255,255,0.12)" }}
          title="Exit mode"
        >
          <X size={11} />
        </span>
      </button>
    );
  }
  return (
    <button onClick={onOpen} className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium" style={{ background: C.panelAlt, color: C.text, border: `1px solid ${C.border}` }} title="Modes">
      <Wand2 size={16} />
      Modes
    </button>
  );
}

// Desktop only — mobile keeps the header compact per your feedback about
// needing to scroll just to reach the Modes button.
function ModeTeaser({ onPick }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % MODE_ORDER.length), 2500);
    return () => clearInterval(id);
  }, []);
  const meta = MODES_META[MODE_ORDER[idx]];
  return (
    <button
      onClick={() => onPick(meta.id)}
      className="mx-auto mt-2 hidden items-center gap-2 rounded-full px-3 py-1 text-xs transition-colors lg:flex"
      style={{ background: C.panelAlt, color: C.muted, border: `1px solid ${C.border}` }}
      key={meta.id}
    >
      <span style={{ animation: `${meta.anim} 1.8s ease-in-out infinite`, display: "inline-block" }}>{meta.emoji}</span>
      Try {meta.label}
    </button>
  );
}

export default function App() {
  const { messages, thinking, connected, send, sendMode, appendLocalMessages, invokeTool } = useAnnaAgentStream();
  const [input, setInput] = useState("");

  const [videoHistory, setVideoHistory] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileVideosOpen, setMobileVideosOpen] = useState(false);
  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const hasAutoOpenedRef = useRef(false);

  const [modesOpen, setModesOpen] = useState(false);
  const [modesInitialSelected, setModesInitialSelected] = useState(null);
  const [activeMode, setActiveMode] = useState(null);

  const scrollRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const desktopTextareaRef = useRef(null);
  const mobileTextareaRef = useRef(null);
  const videoNodeMap = useRef(new Map());
  const registerVideoNode = useCallback((id, node) => {
    if (node) videoNodeMap.current.set(id, node);
    else videoNodeMap.current.delete(id);
  }, []);

  const handleTranscribed = useCallback((text) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
  }, []);
  const voice = useVoiceInput(invokeTool, handleTranscribed);

  // Tracks whether the user is currently near the bottom of the chat, so the
  // auto-scroll below only fires when they're actively following along —
  // not every time a status update ticks in while they're scrolled up
  // looking at something (like a video) on purpose.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = distanceFromBottom < 120;
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    [desktopTextareaRef.current, mobileTextareaRef.current].forEach((el) => {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
    });
  }, [input]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "agent" || last.streaming) return;
    const found = extractVideos(last.text);
    if (!found.length) return;
    setVideoHistory((prev) => {
      const known = new Set(prev.map((v) => v.id));
      const additions = found.filter((v) => !known.has(v.id));
      return additions.length ? [...prev, ...additions] : prev;
    });
    if (!hasAutoOpenedRef.current) {
      setPanelOpen(true);
      hasAutoOpenedRef.current = true;
    }
  }, [messages]);

  const lastVideoMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "agent" && extractVideos(messages[i].text).length) return messages[i].id;
    }
    return null;
  }, [messages]);

  const submit = (text) => {
    const value = (text ?? input).trim();
    if (!value || thinking) return;
    send(value, activeMode?.id);
    setInput("");
  };

  const handleModeActivate = (modeId, answers) => {
    setModesOpen(false);
    setModesInitialSelected(null);
    setActiveMode(MODES_META[modeId]);
    sendMode(modeId, answers);
  };

  const jumpToLastVideo = () => {
    const node = lastVideoMessageId && videoNodeMap.current.get(lastVideoMessageId);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="app-shell flex w-full overflow-hidden" style={{ background: C.bg, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        .app-shell { height: 100vh; }
        @supports (height: 100dvh) { .app-shell { height: 100dvh; } }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 8px; }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5 } 40% { transform: translateY(-4px); opacity: 1 } }
        .animate-bounce { animation: bounce 1.1s infinite ease-in-out; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes waveform { 0%, 100% { height: 4px; } 50% { height: 16px; } }
        @keyframes modeBounce { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-6px) rotate(-8deg); } }
        @keyframes modeFlicker { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.82; } }
        @keyframes modePulseGlow { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes modeWiggle { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
        @keyframes modeBlink { 0%,42%,58%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes modeTargetPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        @keyframes modeGlowSoft { 0%,100% { opacity: 0.85; filter: brightness(1); } 50% { opacity: 1; filter: brightness(1.3); } }
      `}</style>

      <GrainOverlay />

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="grid grid-cols-3 items-center px-4 py-3 lg:px-5 lg:py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: C.cyanDim }}>
              <Sparkles size={15} style={{ color: C.cyan }} />
            </div>
            <div>
              <div className="text-sm font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
                Bob
              </div>
              <div className="hidden text-[11px] lg:block" style={{ color: connected ? C.muted : C.red }}>
                {connected ? "YouTube research agent" : "Connecting…"}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center">
            <ModesButton activeMode={activeMode} onOpen={() => setModesOpen(true)} onClear={() => setActiveMode(null)} />
            <ModeTeaser
              onPick={(id) => {
                setModesInitialSelected(id);
                setModesOpen(true);
              }}
            />
          </div>

          <div className="relative flex items-center justify-end gap-2">
            {videoHistory.length > 0 && (
              <button
                onClick={() => setPanelOpen((v) => !v)}
                className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs lg:flex"
                style={{ background: panelOpen ? C.panelAlt : C.redDim, color: panelOpen ? C.muted : C.red, border: `1px solid ${panelOpen ? C.border : "transparent"}` }}
                title={panelOpen ? "Hide videos" : "Show videos"}
              >
                <PanelRightOpen size={13} />
                Videos
                <span className="rounded-full px-1.5 text-[10px]" style={{ background: "rgba(255,255,255,0.08)", fontFamily: "'JetBrains Mono', monospace" }}>
                  {videoHistory.length}
                </span>
              </button>
            )}

            <button
              onClick={() => setHelpMenuOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: C.panelAlt, color: C.muted, border: `1px solid ${C.border}` }}
              title="Help"
            >
              <HelpCircle size={16} />
            </button>

            {helpMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setHelpMenuOpen(false)} />
                <div className="absolute right-0 top-11 z-40 w-48 overflow-hidden rounded-xl shadow-2xl" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
                  <button
                    onClick={() => {
                      setCapabilitiesOpen(true);
                      setHelpMenuOpen(false);
                    }}
                    className="block w-full px-4 py-3 text-left text-sm"
                    style={{ color: C.text }}
                  >
                    ✨ Capabilities
                  </button>
                  <div style={{ borderTop: `1px solid ${C.border}` }} />
                  <button
                    onClick={() => {
                      setFeedbackOpen(true);
                      setHelpMenuOpen(false);
                    }}
                    className="block w-full px-4 py-3 text-left text-sm"
                    style={{ color: C.text }}
                  >
                    💬 Feedback
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-5 lg:px-5 lg:py-6">
          {messages.length === 0 ? (
            <EmptyState onPick={(text) => submit(text)} />
          ) : (
            messages.map((m) =>
              m.role === "agent" && m.streaming && !m.text ? <TypingIndicator key={m.id} status={m.status} /> : <MessageBubble key={m.id} msg={m} registerVideoNode={registerVideoNode} invokeTool={invokeTool} />
            )
          )}
        </div>

        {voice.warning && (
          <div className="mx-auto mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ maxWidth: COMPOSER_MAX_WIDTH, background: C.redDim, color: C.red }}>
            <AlertCircle size={13} className="shrink-0" />
            <span className="flex-1">{voice.warning}</span>
            <button onClick={voice.dismissWarning} style={{ color: C.red }}>
              <X size={13} />
            </button>
          </div>
        )}

        {voice.recording && (
          <div className="mx-auto mb-2 flex w-full items-center justify-center gap-2" style={{ maxWidth: COMPOSER_MAX_WIDTH }}>
            <MicWaveform />
            <span className="text-xs" style={{ color: C.red, fontFamily: "'JetBrains Mono', monospace" }}>
              {fmtTime(voice.seconds)} — tap to stop
            </span>
          </div>
        )}

        {/* Desktop composer — mic and send as separate detached circles */}
        <div className="hidden justify-center px-5 pb-5 pt-2 lg:flex">
          <div className="flex w-full items-end gap-2.5" style={{ maxWidth: COMPOSER_MAX_WIDTH }}>
            <button
              onClick={voice.toggle}
              disabled={voice.transcribing}
              title={voice.recording ? "Tap to stop" : "Record a voice message"}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors"
              style={{ background: voice.recording ? C.red : C.panelAlt, color: voice.recording ? "#FFFFFF" : C.muted, border: `1px solid ${voice.recording ? "transparent" : C.border}` }}
            >
              {voice.transcribing ? <Loader2 size={18} className="animate-spin" /> : voice.recording ? <Square size={15} /> : <Mic size={18} />}
            </button>

            <textarea
              ref={desktopTextareaRef}
              rows={1}
              maxLength={MAX_MESSAGE_CHARS}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={voice.transcribing ? "Transcribing your voice message…" : "Ask Bob to find or explain a video…"}
              disabled={voice.transcribing}
              className="min-w-0 flex-1 resize-none rounded-2xl px-4 py-4 text-sm outline-none"
              style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text, maxHeight: TEXTAREA_MAX_HEIGHT }}
            />

            <button
              onClick={() => submit()}
              disabled={thinking}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-opacity"
              style={{ background: C.cyan, color: "#08131A", opacity: thinking ? 0.7 : 1 }}
              title={thinking ? "Bob is thinking…" : "Send"}
            >
              {thinking ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile composer — one rounded box, mic + send pinned inside it */}
        <div className="px-3 pb-3 pt-1 lg:hidden">
          <div className="flex flex-col gap-2 rounded-2xl px-3 pb-2 pt-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <textarea
              ref={mobileTextareaRef}
              rows={1}
              maxLength={MAX_MESSAGE_CHARS}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={voice.transcribing ? "Transcribing…" : "Ask Bob anything…"}
              disabled={voice.transcribing}
              className="w-full resize-none bg-transparent outline-none"
              style={{ color: C.text, maxHeight: TEXTAREA_MAX_HEIGHT, fontSize: MOBILE_INPUT_FONT_SIZE }}
            />
            <div className="flex items-center justify-between">
              <button
                onClick={voice.toggle}
                disabled={voice.transcribing}
                title={voice.recording ? "Tap to stop" : "Record a voice message"}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                style={{ background: voice.recording ? C.red : C.panelAlt, color: voice.recording ? "#FFFFFF" : C.muted }}
              >
                {voice.transcribing ? <Loader2 size={14} className="animate-spin" /> : voice.recording ? <Square size={12} /> : <Mic size={14} />}
              </button>
              <button
                onClick={() => submit()}
                disabled={thinking}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-opacity"
                style={{ background: C.cyan, color: "#08131A", opacity: thinking ? 0.7 : 1 }}
                title={thinking ? "Bob is thinking…" : "Send"}
              >
                {thinking ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <WatchPanel videos={videoHistory} open={panelOpen} onClose={() => setPanelOpen(false)} />
      <MobileVideosOverlay open={mobileVideosOpen} videos={videoHistory} onClose={() => setMobileVideosOpen(false)} />

      <DesktopMiniPlayer video={!panelOpen ? videoHistory[videoHistory.length - 1] : null} onOpen={() => setPanelOpen(true)} />
      {videoHistory.length > 0 && <DraggableVideosButton count={videoHistory.length} onOpen={() => setMobileVideosOpen(true)} />}

      <ModesOverlay open={modesOpen} onClose={() => setModesOpen(false)} onActivate={handleModeActivate} initialSelected={modesInitialSelected} />
      <CapabilitiesOverlay open={capabilitiesOpen} onClose={() => setCapabilitiesOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} invokeTool={invokeTool} />
    </div>
  );
}
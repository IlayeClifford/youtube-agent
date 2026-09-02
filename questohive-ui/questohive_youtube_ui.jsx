import { useState, useRef, useEffect, useCallback } from "react";
import { Send, X, Youtube, Clock, Sparkles, PlayCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Palette (derived from the "Power of Yellow" brief: navy/cyan base, yellow
// reserved as the single accent — used only for the Watch panel + signature
// timestamp pills, never decoratively).
// ---------------------------------------------------------------------------
const C = {
  bg: "#0A0E17",
  panel: "#0F1524",
  panelAlt: "#121A2B",
  border: "#1C2333",
  cyan: "#5CD3EC",
  cyanDim: "#2B4A56",
  red: "#F0463E",
  redDim: "#3D1917",
  text: "#E9EEF7",
  muted: "#7C879B",
  mutedDark: "#4B5568",
};

const FONT_IMPORT_URL =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

// ---------------------------------------------------------------------------
// YouTube helpers
// ---------------------------------------------------------------------------
const YT_REGEX =
  /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+(?:[&?]t=\d+s?)?)/g;

function parseYoutubeUrl(url) {
  try {
    const u = new URL(url);
    let id = null;
    if (u.hostname.includes("youtu.be")) {
      id = u.pathname.slice(1);
    } else {
      id = u.searchParams.get("v");
    }
    const tParam = u.searchParams.get("t");
    const start = tParam ? parseInt(tParam.replace("s", ""), 10) : 0;
    return id ? { id, start } : null;
  } catch {
    return null;
  }
}

function extractVideos(text) {
  const matches = text.match(YT_REGEX) || [];
  return matches
    .map((url) => {
      const parsed = parseYoutubeUrl(url);
      return parsed ? { url, ...parsed } : null;
    })
    .filter(Boolean);
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Mock conversation + mock transcript-chunk data (mirrors the shape your
// `transcription` tool actually returns, so the pills below are wired to
// something real once you swap in live agent output).
// ---------------------------------------------------------------------------
const MOCK_CHUNKS = {
  dQw4w9WgXcQ: [
    { start: 0, end: 30, label: "Intro & framing" },
    { start: 30, end: 75, label: "Core idea explained" },
    { start: 75, end: 120, label: "Worked example" },
    { start: 120, end: 160, label: "Recap & takeaway" },
  ],
  jNQXAC9IVRw: [
    { start: 0, end: 40, label: "Setup" },
    { start: 40, end: 95, label: "Key demonstration" },
    { start: 95, end: 140, label: "Q&A moment" },
  ],
};

const INITIAL_MESSAGES = [];

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function Avatar({ role }) {
  const isAgent = role === "agent";
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{
        background: isAgent ? C.cyanDim : C.panelAlt,
        color: isAgent ? C.cyan : C.muted,
        border: `1px solid ${C.border}`,
        fontFamily: "'Space Grotesk', sans-serif",
      }}
    >
      {isAgent ? "B" : "Y"}
    </div>
  );
}

function InlineVideoChip({ video, onOpen }) {
  return (
    <button
      onClick={() => onOpen(video)}
      className="mt-2 flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors"
      style={{ background: C.panelAlt, border: `1px solid ${C.border}` }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ background: C.redDim, color: C.red }}
      >
        <PlayCircle size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-sm"
          style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}
        >
          Watch clip
        </div>
        <div
          className="text-xs"
          style={{ color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}
        >
          starts at {fmtTime(video.start)}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ msg, isMobile, onOpenVideo }) {
  const isAgent = msg.role === "agent";
  const videos = extractVideos(msg.text);
  const cleanText = msg.text.replace(YT_REGEX, "").trim();

  return (
    <div className={`flex gap-3 ${isAgent ? "" : "flex-row-reverse"}`}>
      <Avatar role={msg.role} />
      <div className={`max-w-[80%] ${isAgent ? "" : "flex flex-col items-end"}`}>
        <div
          className="rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-line"
          style={{
            background: isAgent ? C.panel : C.cyanDim,
            border: `1px solid ${isAgent ? C.border : "transparent"}`,
            color: C.text,
            fontFamily: "'Inter', sans-serif",
            borderTopLeftRadius: isAgent ? 4 : undefined,
            borderTopRightRadius: !isAgent ? 4 : undefined,
          }}
        >
          {cleanText}
        </div>
        {isMobile &&
          videos.map((v) => (
            <InlineVideoChip key={v.url} video={v} onOpen={onOpenVideo} />
          ))}
      </div>
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
            style={{
              background: active ? C.red : "transparent",
              color: active ? "#FFFFFF" : C.muted,
              border: `1px solid ${active ? C.red : C.border}`,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            <Clock size={11} />
            {fmtTime(c.start)}
            <span
              className="hidden sm:inline"
              style={{
                fontFamily: "'Inter', sans-serif",
                color: active ? "#FFFFFF" : C.mutedDark,
              }}
            >
              · {c.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function VideoCard({ video, onSeekRegister }) {
  const iframeRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const seek = useCallback((v, chunk, idx) => {
    setActiveIndex(idx);
    const win = iframeRef.current?.contentWindow;
    if (win) {
      win.postMessage(
        JSON.stringify({
          event: "command",
          func: "seekTo",
          args: [chunk.start, true],
        }),
        "*"
      );
    }
  }, []);

  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: C.panel, border: `1px solid ${C.border}` }}
    >
      <div className="relative aspect-video w-full" style={{ background: "#000" }}>
        <iframe
          ref={iframeRef}
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
          <span
            className="text-xs"
            style={{ color: C.muted, fontFamily: "'JetBrains Mono', monospace" }}
          >
            {video.id}
          </span>
        </div>
        <TimestampPills video={video} activeIndex={activeIndex} onSeek={seek} />
      </div>
    </div>
  );
}

function WatchPanel({ videos, open, onClose }) {
  return (
    <div
      className="hidden shrink-0 overflow-hidden transition-all duration-500 ease-out lg:flex"
      style={{
        width: open ? "50%" : "0%",
        borderLeft: open ? `1px solid ${C.border}` : "none",
      }}
    >
      <div className="flex h-full w-full flex-col" style={{ minWidth: 420 }}>
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-2">
            <Youtube size={16} style={{ color: C.red }} />
            <span
              className="text-sm font-semibold tracking-wide"
              style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Watch
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{
                background: C.redDim,
                color: C.red,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {videos.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 transition-colors"
            style={{ color: C.muted }}
          >
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

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div style={{ filter: `drop-shadow(0 0 48px ${C.red}4D)` }}>
        <BrandMark />
      </div>
      <div>
        <div
          className="text-lg font-semibold"
          style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}
        >
          Ask Bob anything
        </div>
        <div className="mx-auto mt-1.5 max-w-xs text-sm" style={{ color: C.muted }}>
          Search, summarize, or jump straight to the moment you need in any YouTube video.
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <Avatar role="agent" />
      <div
        className="flex items-center gap-1 rounded-2xl px-4 py-3"
        style={{ background: C.panel, border: `1px solid ${C.border}`, borderTopLeftRadius: 4 }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full"
            style={{ background: C.cyan, animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const scrollRef = useRef(null);

  const lastAgentVideos =
    [...messages].reverse().find((m) => m.role === "agent" && extractVideos(m.text).length)
      ?.text || "";
  const activeVideos = extractVideos(lastAgentVideos);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const userMsg = { id: `u-${Date.now()}`, role: "user", text: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);

    setTimeout(() => {
      const agentMsg = {
        id: `a-${Date.now()}`,
        role: "agent",
        text:
          "Here's a clip on that — the relevant part kicks in a little past the start.\n\nhttps://www.youtube.com/watch?v=jNQXAC9IVRw&t=40s",
      };
      setMessages((prev) => [...prev, agentMsg]);
      setThinking(false);
      setPanelOpen(true);
    }, 1100);
  };

  return (
    <div
      className="flex h-screen w-full overflow-hidden"
      style={{ background: C.bg, fontFamily: "'Inter', sans-serif" }}
    >
      <style>{`@import url('${FONT_IMPORT_URL}');
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 8px; }
        @keyframes bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .5 } 40% { transform: translateY(-4px); opacity: 1 } }
        .animate-bounce { animation: bounce 1.1s infinite ease-in-out; }
      `}</style>

      {/* Chat pane */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: C.cyanDim }}
            >
              <Sparkles size={15} style={{ color: C.cyan }} />
            </div>
            <div>
              <div
                className="text-sm font-semibold"
                style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Bob
              </div>
              <div className="text-[11px]" style={{ color: C.muted }}>
                YouTube research agent
              </div>
            </div>
          </div>
          {activeVideos.length > 0 && !panelOpen && (
            <button
              onClick={() => setPanelOpen(true)}
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs lg:flex"
              style={{ background: C.redDim, color: C.red, fontFamily: "'Inter', sans-serif" }}
            >
              <Youtube size={13} /> Show videos
            </button>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
          {messages.length === 0 && !thinking ? (
            <EmptyState />
          ) : (
            messages.map((m) => (
              <MessageBubble key={m.id} msg={m} isMobile onOpenVideo={() => setPanelOpen(true)} />
            ))
          )}
          {thinking && <TypingIndicator />}
        </div>

        {/* Composer */}
        <div className="px-5 pb-5 pt-2">
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: C.panel, border: `1px solid ${C.border}` }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Ask Bob to find or explain a video…"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: C.text, fontFamily: "'Inter', sans-serif" }}
            />
            <button
              onClick={sendMessage}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-opacity"
              style={{ background: C.cyan, color: "#08131A" }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Watch panel — desktop only, videos live inline on mobile */}
      <WatchPanel
        videos={activeVideos}
        open={panelOpen && activeVideos.length > 0}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}
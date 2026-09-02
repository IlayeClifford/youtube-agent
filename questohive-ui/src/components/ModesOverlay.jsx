import { useEffect, useRef, useState } from "react";
import { X, ArrowLeft } from "lucide-react";
import { C } from "../lib/theme";
import { MODES_META, MODE_ORDER, TIME_OPTIONS } from "../lib/modes";
import { parseYoutubeUrl } from "../lib/youtube";

function FieldLabel({ children }) {
  return (
    <div className="mb-2 text-xs font-semibold" style={{ color: C.muted }}>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs transition-colors"
      style={{
        background: active ? C.cyan : C.panelAlt,
        color: active ? "#08131A" : C.text,
        border: `1px solid ${active ? "transparent" : C.border}`,
      }}
    >
      {children}
    </button>
  );
}

function RegionField({ value, onChange }) {
  const [typing, setTyping] = useState(Boolean(value) && value !== "general");
  return (
    <div>
      <FieldLabel>Country of interest</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Chip
          active={value === "general"}
          onClick={() => {
            onChange("general");
            setTyping(false);
          }}
        >
          General
        </Chip>
        <Chip active={typing} onClick={() => setTyping(true)}>
          Type a country
        </Chip>
      </div>
      {typing && (
        <input
          autoFocus
          value={value === "general" ? "" : value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Nigeria"
          className="mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
        />
      )}
    </div>
  );
}

function TimeField({ value, onChange }) {
  const [custom, setCustom] = useState(false);
  return (
    <div>
      <FieldLabel>How much time do you have?</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {TIME_OPTIONS.map((o) => (
          <Chip
            key={o.value}
            active={value === o.value && !custom}
            onClick={() => {
              onChange(o.value);
              setCustom(false);
            }}
          >
            {o.label}
          </Chip>
        ))}
        <Chip active={custom} onClick={() => setCustom(true)}>
          Custom
        </Chip>
      </div>
      {custom && (
        <input
          autoFocus
          type="number"
          min="1"
          placeholder="Minutes"
          onChange={(e) => onChange(e.target.value ? `${e.target.value} minutes` : "not_sure")}
          className="mt-2 w-32 rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
        />
      )}
    </div>
  );
}

// Two-tier cluster -> item picker. `categories` comes from the active
// mode's meta.categories, so this same component serves Podcast,
// Entertainment, and Business without knowing which one it's in.
function CategoryField({ label, categories, value, onChange }) {
  const [cluster, setCluster] = useState(null);

  if (!cluster) {
    return (
      <div>
        <FieldLabel>{label}</FieldLabel>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {categories.map((c) => (
            <button
              key={c.cluster}
              onClick={() => setCluster(c)}
              className="rounded-lg px-3 py-2 text-left text-sm"
              style={{ background: C.panelAlt, color: C.text, border: `1px solid ${C.border}` }}
            >
              {c.cluster}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setCluster(null)} className="mb-2 flex items-center gap-1 text-xs" style={{ color: C.muted }}>
        <ArrowLeft size={12} /> {cluster.cluster}
      </button>
      <div className="flex flex-wrap gap-2">
        {cluster.items.map((item) => (
          <Chip key={item} active={value === item} onClick={() => onChange(item)}>
            {item}
          </Chip>
        ))}
      </div>
    </div>
  );
}

// Flat chip list + "Surprise me" + "Type your own". `options` comes from
// the active mode's meta.flatOptions — serves Sermons, Tech, Productivity.
function TopicChoiceField({ label, options, value, onChange }) {
  const [typing, setTyping] = useState(Boolean(value) && !options.includes(value) && value !== "surprise");
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {options.map((t) => (
          <Chip
            key={t}
            active={value === t}
            onClick={() => {
              onChange(t);
              setTyping(false);
            }}
          >
            {t}
          </Chip>
        ))}
        <Chip
          active={value === "surprise"}
          onClick={() => {
            onChange("surprise");
            setTyping(false);
          }}
        >
          ✨ Surprise me
        </Chip>
        <Chip active={typing} onClick={() => setTyping(true)}>
          Type your own
        </Chip>
      </div>
      {typing && (
        <input
          autoFocus
          value={!options.includes(value) && value !== "surprise" ? value || "" : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a focus area"
          className="mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
        />
      )}
    </div>
  );
}

// "Random/Any X" chip vs typing a specific name. Serves the Preacher field.
function NameOrRandomField({ label, placeholder, defaultLabel, value, onChange }) {
  const [typing, setTyping] = useState(Boolean(value) && value !== "random");
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        <Chip
          active={value === "random"}
          onClick={() => {
            onChange("random");
            setTyping(false);
          }}
        >
          {defaultLabel}
        </Chip>
        <Chip active={typing} onClick={() => setTyping(true)}>
          Type a name
        </Chip>
      </div>
      {typing && (
        <input
          autoFocus
          value={value === "random" ? "" : value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
        />
      )}
    </div>
  );
}

function TextField({ label, placeholder, value, onChange }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}
      />
    </div>
  );
}

function ModeDetail({ modeId, onBack, onActivate }) {
  const meta = MODES_META[modeId];
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");

  const setField = (key, val) => {
    setError("");
    setAnswers((a) => ({ ...a, [key]: val }));
  };

  const handleStart = () => {
    if (meta.fields.includes("topic") && !answers.topic?.trim()) {
      setError("Tell Bob what you want to learn about.");
      return;
    }
    if (meta.fields.includes("category") && !answers.category) {
      setError("Pick a category.");
      return;
    }
    if (meta.fields.includes("topic_choice") && !answers.topic_choice) {
      setError("Pick a focus, or tap Surprise me.");
      return;
    }
    if (meta.fields.includes("video_url")) {
      const parsed = answers.video_url && parseYoutubeUrl(answers.video_url.trim());
      if (!parsed) {
        setError("That doesn't look like a valid YouTube link.");
        return;
      }
    }
    onActivate(modeId, answers);
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10 text-center">
      <button onClick={onBack} className="absolute left-0 top-0 flex items-center gap-1 text-sm" style={{ color: C.muted }}>
        <ArrowLeft size={16} /> Back
      </button>

      <div
        className="flex h-20 w-20 items-center justify-center rounded-3xl text-4xl"
        style={{ background: `${meta.glow}22`, boxShadow: `0 0 60px ${meta.glow}55`, animation: `${meta.anim} 1.8s ease-in-out infinite` }}
      >
        {meta.emoji}
      </div>

      <div className="text-lg font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
        {meta.label}
      </div>

      <div className="w-full space-y-5 text-left">
        {meta.fields.includes("region") && <RegionField value={answers.region} onChange={(v) => setField("region", v)} />}
        {meta.fields.includes("category") && (
          <CategoryField label={`${meta.label} category`} categories={meta.categories} value={answers.category} onChange={(v) => setField("category", v)} />
        )}
        {meta.fields.includes("topic_choice") && <TopicChoiceField label="Focus" options={meta.flatOptions} value={answers.topic_choice} onChange={(v) => setField("topic_choice", v)} />}
        {meta.fields.includes("topic") && (
          <TextField label="What do you want to learn?" placeholder="e.g. how transformers work" value={answers.topic} onChange={(v) => setField("topic", v)} />
        )}
        {meta.fields.includes("constraints") && (
          <TextField label="Any constraints? (optional)" placeholder="e.g. beginner-friendly, or paste a video link" value={answers.constraints} onChange={(v) => setField("constraints", v)} />
        )}
        {meta.fields.includes("video_url") && (
          <TextField label="Paste the video link" placeholder="https://youtube.com/watch?v=..." value={answers.video_url} onChange={(v) => setField("video_url", v)} />
        )}
        {meta.fields.includes("podcaster") && (
          <TextField label="Specific podcaster? (optional)" placeholder="e.g. Joe Rogan, Diary of a CEO" value={answers.podcaster} onChange={(v) => setField("podcaster", v)} />
        )}
        {meta.fields.includes("creator") && (
          <TextField label="Specific creator? (optional)" placeholder="e.g. MrBeast, MKBHD" value={answers.creator} onChange={(v) => setField("creator", v)} />
        )}
        {meta.fields.includes("preacher") && (
          <NameOrRandomField label="Preacher" placeholder="e.g. a preacher's name" defaultLabel="Random / Any preacher" value={answers.preacher} onChange={(v) => setField("preacher", v)} />
        )}
        {meta.fields.includes("time_constraint") && <TimeField value={answers.time_constraint} onChange={(v) => setField("time_constraint", v)} />}
      </div>

      {error && (
        <div className="text-xs" style={{ color: C.red }}>
          {error}
        </div>
      )}

      <button onClick={handleStart} className="w-full rounded-full py-3 text-sm font-semibold" style={{ background: meta.glow, color: "#0A0E17" }}>
        Start {meta.label}
      </button>
    </div>
  );
}

function ModeCard({ mode, onSelect, featured, cardRef }) {
  return (
    <div ref={cardRef} style={{ scrollSnapAlign: "center" }}>
      <button
        onClick={() => onSelect(mode.id)}
        className="flex w-52 shrink-0 flex-col items-center gap-3 rounded-2xl p-6 text-center transition-all duration-500"
        style={{
          background: C.panel,
          border: `1px solid ${featured ? mode.glow : C.border}`,
          boxShadow: featured ? `0 0 40px ${mode.glow}33` : "none",
          transform: featured ? "scale(1.05)" : "scale(0.92)",
          opacity: featured ? 1 : 0.55,
        }}
      >
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
          style={{ background: `${mode.glow}22`, animation: `${mode.anim} 1.8s ease-in-out infinite` }}
        >
          {mode.emoji}
        </div>
        <div className="text-sm font-semibold" style={{ color: C.text, fontFamily: "'Space Grotesk', sans-serif" }}>
          {mode.label}
        </div>
      </button>
    </div>
  );
}

function ModeCarousel({ onSelect }) {
  const [slide, setSlide] = useState(0);
  const cardRefs = useRef({});

  useEffect(() => {
    const id = setInterval(() => setSlide((s) => (s + 1) % MODE_ORDER.length), 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const modeId = MODE_ORDER[slide];
    cardRefs.current[modeId]?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [slide]);

  return (
    <div
      className="flex w-full items-center gap-4 overflow-x-auto py-4"
      style={{ scrollSnapType: "x mandatory", paddingLeft: "calc(50% - 6.5rem)", paddingRight: "calc(50% - 6.5rem)" }}
    >
      {MODE_ORDER.map((id, i) => (
        <ModeCard
          key={id}
          mode={MODES_META[id]}
          onSelect={onSelect}
          featured={i === slide}
          cardRef={(node) => (cardRefs.current[id] = node)}
        />
      ))}
    </div>
  );
}

export default function ModesOverlay({ open, onClose, onActivate, initialSelected }) {
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setSelected(open ? initialSelected || null : null);
  }, [open, initialSelected]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "rgba(10,14,23,0.97)", backdropFilter: "blur(8px)" }}>
      <style>{`
        @keyframes modeBounce { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-6px) rotate(-8deg); } }
        @keyframes modeFlicker { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.82; } }
        @keyframes modePulseGlow { 0%,100% { transform: scale(1); } 50% { transform: scale(1.08); } }
        @keyframes modeWiggle { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
        @keyframes modeBlink { 0%,42%,58%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes modeTargetPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.15); } }
        @keyframes modeGlowSoft { 0%,100% { opacity: 0.85; filter: brightness(1); } 50% { opacity: 1; filter: brightness(1.3); } }
      `}</style>

      <div className="flex justify-end p-5">
        <button onClick={onClose} className="rounded-full p-2" style={{ background: C.panelAlt, color: C.muted }}>
          <X size={18} />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {!selected && (
          <div className="w-full text-center">
            <div className="mb-6 text-sm" style={{ color: C.muted }}>
              Pick a mode to get started
            </div>
            <ModeCarousel onSelect={setSelected} />
          </div>
        )}
        {selected && <ModeDetail modeId={selected} onBack={() => setSelected(null)} onActivate={onActivate} />}
      </div>
    </div>
  );
}
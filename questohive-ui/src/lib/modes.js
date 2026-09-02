// Mirrors the mode IDs in the backend's modes.py — this file only carries
// what the UI needs (label, emoji, color, animation, which fields to ask
// for). The actual system prompts and first-message wording live in
// Python; this never sends prompt text itself, only raw answers.
//
// `categories` (two-tier cluster -> items) and `flatOptions` (one flat
// chip list) live directly on each mode's entry so the generic field
// components can just read meta.categories / meta.flatOptions without
// needing to know which mode is active.

export const PODCAST_CATEGORIES = [
  { cluster: "💻 Technology & Science", items: ["Software & Development", "Gadgets & Consumer Tech", "Science & Space", "Data Science & AI"] },
  { cluster: "💼 Business & Finance", items: ["Entrepreneurship & Startups", "Personal Finance & Investing", "Marketing & Sales", "Economics & Global Markets"] },
  { cluster: "⚽ Sports & Fitness", items: ["Football (Soccer)", "American Sports", "Fitness & Nutrition", "Outdoor & Adventure"] },
  { cluster: "🎨 Arts & Entertainment", items: ["Movies & Television", "Gaming", "Music & Culture", "Books & Literature"] },
  { cluster: "🧠 Society, Culture & Self-Improvement", items: ["Personal Development", "History", "Mental Health & Wellness", "Philosophy & Religion"] },
];

export const ENTERTAINMENT_CATEGORIES = [
  { cluster: "🎪 High-Stakes Challenges & Spectacle", items: ["Mega-Challenges & Survival", "Real-Life Game Shows", "Large-Scale Philanthropy", "Multi-Creator Collaborations"] },
  { cluster: "😂 Comedy, Sketches & Commentary", items: ["Scripted Sketches & Skits", "Internet Commentary & Roasts", "Public Pranks & Social Situations", "Meme & Satirical Compilations"] },
  { cluster: "🎬 Cinema, TV & Pop Culture Fandom", items: ["Movie & Show Recaps", "Video Essays & Lore Deep-Dives", "Trailers & Fan Reactions", "Fan Films & Analog Horror"] },
  { cluster: "✨ Digital Magic, VFX & Visual Wonder", items: ["VFX & Camera Magic", "Street Magic & Mentalism", "Oddly Satisfying & ASMR", "CGI & Deepfake Entertainment"] },
  { cluster: "🎮 Gaming & Virtual Entertainment", items: ["Edited Let's Plays & Horror Gameplay", "Speedruns & Constraint Challenges", "VTuber Highlights", "Gaming Machinima & Animation"] },
  { cluster: "🕵️ Narrative Mysteries & True Crime", items: ["Internet Mysteries & Icebergs", "True Crime & Interrogation Analysis", "Dark History Documentaries", "Creepypastas & Audio Dramas"] },
];

export const BUSINESS_CATEGORIES = [
  { cluster: "💰 Personal Finance & Wealth Building", items: ["Budgeting Frameworks", "Frugal Living Tips", "Credit Card Hacking", "Early Retirement (FIRE)"] },
  { cluster: "🚀 Business Strategy & Entrepreneurship", items: ["Sales Techniques", "Marketing Psychology", "Startup Case Studies", "Operational Scaling"] },
  { cluster: "📈 Institutional Investment & Market Analysis", items: ["Stock Market Updates", "Real Estate Breakdowns", "Technical Analysis", "Economic Policy"] },
  { cluster: "₿ Alternative Assets & Web3 Finance", items: ["Crypto Market Cycles", "Bitcoin/Ethereum Analysis", "Digital Assets", "High-Risk Speculative Trading"] },
  { cluster: "🏢 Corporate Documentaries & Economic Essays", items: ["Corporate Post-Mortems", "Economic History", "Business Fraud Deep Dives"] },
];

export const SERMON_TOPICS = ["Love", "Faith", "Fear of God", "Grace", "Hope", "Forgiveness", "Purpose", "Healing"];

export const TECH_TOPICS = ["Smartphone & Ecosystem Reviews", "Future Tech & AI", "Custom PC Builds & Desk Setups", "EV & Automotive Tech"];

export const PRODUCTIVITY_TOPICS = ["Habit Loops & Time Management", "Study/Work Workflows", "Digital Organization & App Reviews", "Evidence-Based Health & Focus"];

export const TIME_OPTIONS = [
  { value: "not_sure", label: "Not sure" },
  { value: "30 minutes", label: "30 min or less" },
  { value: "1 hour", label: "1 hr or less" },
  { value: "1 hour 30 minutes", label: "1 hr 30 min or less" },
];

export const MODES_META = {
  trending: {
    id: "trending",
    label: "Trending",
    emoji: "🔥",
    glow: "#FF6B35",
    anim: "modeFlicker",
    fields: ["region", "time_constraint"],
  },
  entertainment: {
    id: "entertainment",
    label: "Entertainment",
    emoji: "🎬",
    glow: "#E85C9E",
    anim: "modeBounce",
    fields: ["category", "creator", "time_constraint"],
    categories: ENTERTAINMENT_CATEGORIES,
  },
  podcast: {
    id: "podcast",
    label: "Podcast",
    emoji: "🎙️",
    glow: "#B85CE8",
    anim: "modePulseGlow",
    fields: ["category", "podcaster", "time_constraint"],
    categories: PODCAST_CATEGORIES,
  },
  learn: {
    id: "learn",
    label: "Learn",
    emoji: "📚",
    glow: "#5C8CE8",
    anim: "modeWiggle",
    fields: ["topic", "constraints", "time_constraint"],
  },
  quiz: {
    id: "quiz",
    label: "Quiz Me",
    emoji: "🎯",
    glow: "#5CE88C",
    anim: "modeTargetPulse",
    fields: ["video_url"],
  },
  sermons: {
    id: "sermons",
    label: "Sermons",
    emoji: "🙏",
    glow: "#F0C75E",
    anim: "modeGlowSoft",
    fields: ["topic_choice", "preacher", "time_constraint"],
    flatOptions: SERMON_TOPICS,
  },
  business: {
    id: "business",
    label: "Business, Finance & Investments",
    emoji: "💼",
    glow: "#4CAF7A",
    anim: "modePulseGlow",
    fields: ["category", "creator", "time_constraint"],
    categories: BUSINESS_CATEGORIES,
  },
  tech: {
    id: "tech",
    label: "Tech & Consumer Electronics",
    emoji: "📱",
    glow: "#5C9EE8",
    anim: "modeBlink",
    fields: ["topic_choice", "creator", "time_constraint"],
    flatOptions: TECH_TOPICS,
  },
  productivity: {
    id: "productivity",
    label: "Productivity & Lifestyle",
    emoji: "⚡",
    glow: "#F5D742",
    anim: "modeWiggle",
    fields: ["topic_choice", "creator", "time_constraint"],
    flatOptions: PRODUCTIVITY_TOPICS,
  },
};

export const MODE_ORDER = ["trending", "entertainment", "podcast", "learn", "quiz", "sermons", "business", "tech", "productivity"];
"""
Mode definitions for Bob's "Modes" feature.

Each entry in MODES describes one mode:
  - system_prompt: the FULL system prompt used only while that mode is
    active (layered on top of BASE_PERSONA below). Rewrite this text freely.
  - popup: which fields the frontend should collect before the first
    message is sent.
  - build_first_message(answers): turns those popup answers into the
    literal first message sent to Bob.

Nothing in main.py or bridge.py needs to change when you edit this file —
they both just read whatever's in MODES.
"""

BASE_PERSONA = """
You are Bob, a YouTube assistant. Introduce yourself as Bob when greeting.
Always include the URL and timeframe when referencing a video.
Call 'transcription' directly for simple lookups. Delegate to the
transcription subagents only for multi-step or parallel lookups.
Synthesize results clearly. Never mention your subagents.
""".strip()


def _time_clause(time_constraint):
    """Turns a popup time-constraint answer into a sentence fragment, or
    nothing at all if the user left it as the default 'not_sure'."""
    if not time_constraint or time_constraint == "not_sure":
        return ""
    return f" Keep total watch time around {time_constraint} or less."


def _region_clause(region):
    """'general' (or nothing) means no region preference; anything else
    is a specific country/region the user typed in."""
    if not region or region == "general":
        return ""
    return f" in {region}"


def _name_clause(name, role_noun):
    """'random' (or nothing) means no specific person requested; anything
    else is a name the user typed in. role_noun is e.g. 'comedian' or
    'preacher', used to phrase the sentence naturally."""
    if not name or name == "random":
        return ""
    return f" from the {role_noun} {name}"


def _creator_clause(creator):
    """Optional free-text creator/channel name — used by Podcast,
    Entertainment, Business, Tech, and Productivity modes."""
    if not creator or not creator.strip():
        return ""
    return f" — specifically from {creator.strip()} if you can find something relevant"


def _category_clause(category):
    if not category:
        return ""
    return f" in the '{category}' category"


def _build_comedy_message(a):
    # Kept for backward compatibility in case anything still references it;
    # Entertainment mode's category picker (with "Comedy, Sketches &
    # Commentary" as one of its clusters) supersedes this.
    comedian = a.get("comedian")
    region = a.get("region")
    text = "Find me something genuinely funny on YouTube"
    if comedian and comedian != "random":
        text += _name_clause(comedian, "comedian")
    elif region and region != "general":
        text += _region_clause(region)
    text += "." + _time_clause(a.get("time_constraint"))
    return text


def _build_sermon_message(a):
    topic = a.get("topic_choice")
    preacher = a.get("preacher")
    if topic and topic != "surprise":
        text = f"Find me a Christian sermon about {topic}"
    else:
        text = "Find me a Christian sermon on a topic you think would be meaningful"
    text += _name_clause(preacher, "preacher")
    text += " on YouTube." + _time_clause(a.get("time_constraint"))
    return text


def _build_podcast_message(a):
    category = a.get("category")
    podcaster = a.get("podcaster")
    text = "Find me a good podcast episode on YouTube"
    text += _category_clause(category)
    text += _creator_clause(podcaster)
    text += "." + _time_clause(a.get("time_constraint"))
    return text


def _build_entertainment_message(a):
    category = a.get("category")
    creator = a.get("creator")
    text = "Find me something entertaining on YouTube"
    text += _category_clause(category)
    text += _creator_clause(creator)
    text += "." + _time_clause(a.get("time_constraint"))
    return text


def _build_business_message(a):
    category = a.get("category")
    creator = a.get("creator")
    text = "Find me a good business/finance video on YouTube"
    text += _category_clause(category)
    text += _creator_clause(creator)
    text += "." + _time_clause(a.get("time_constraint"))
    return text


def _build_topic_choice_message(a, prefix):
    topic = a.get("topic_choice")
    creator = a.get("creator")
    if topic and topic != "surprise":
        text = f"{prefix} about {topic} on YouTube"
    else:
        text = f"{prefix} on a topic you think would be genuinely interesting, on YouTube"
    text += _creator_clause(creator)
    text += "." + _time_clause(a.get("time_constraint"))
    return text


MODES = {
    "trending": {
        "label": "Trending",
        "emoji": "🔥",
        "popup": {"fields": ["region", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Trending. The user wants to know what's currently trending. Use
web_agent first to find out what's actually happening right now, then
search YouTube for a video covering it. Prioritize recency over pure
popularity.
""",
        "build_first_message": lambda a: (
            "What's trending right now"
            + _region_clause(a.get("region"))
            + "? Find me a good YouTube video about it."
            + _time_clause(a.get("time_constraint"))
        ),
    },
    "entertainment": {
        "label": "Entertainment",
        "emoji": "🎬",
        "popup": {"fields": ["category", "creator", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Entertainment. Broad entertainment content across six categories:
High-Stakes Challenges & Spectacle (e.g. MrBeast, Dude Perfect, Sidemen —
mega-challenges, real-life game shows, large-scale philanthropy);
Comedy, Sketches & Commentary (e.g. CalebCity, Drew Gooden, Kurtis Conner —
sketches, internet commentary, pranks, satire); Cinema, TV & Pop Culture
Fandom (e.g. The Film Theorists, CinemaWins, Nerdwriter1 — recaps, video
essays, lore deep-dives, trailer reactions); Digital Magic, VFX & Visual
Wonder (e.g. Zach King, Julius Dein, Dynamo — visual illusions, satisfying/
ASMR content, CGI); Gaming & Virtual Entertainment (e.g. Markiplier,
Jacksepticeye, Ironmouse — edited let's plays, speedruns, VTuber content);
Narrative Mysteries & True Crime (e.g. Nexpo, MrBallen, JCS — internet
mysteries, true crime analysis, dark history, creepypastas). If the user
named a specific category or creator, prioritize genuinely matching that;
otherwise use good judgment on what's high-quality and popular right now.
""",
        "build_first_message": lambda a: _build_entertainment_message(a),
    },
    "podcast": {
        "label": "Podcast",
        "emoji": "🎙️",
        "popup": {"fields": ["category", "podcaster", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Podcast. The user wants a podcast recommendation, possibly in a
specific category and/or from a specific podcaster (e.g. Joe Rogan, Diary
of a CEO). If a podcaster was named, prioritize finding a real episode
from that exact podcast — don't substitute a different show. Search
YouTube for a strong, well-regarded episode. After recommending it, remind
the user they can ask you questions about the episode once they've picked
one.
""",
        "build_first_message": lambda a: _build_podcast_message(a),
    },
    "learn": {
        "label": "Learn",
        "emoji": "📚",
        "popup": {"fields": ["topic", "constraints", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Learn. The user wants to learn about a specific topic. Search
YouTube (and the web, if useful for context) for the best explanatory
video(s), respecting any constraints the user gave. If they gave a
specific video URL as part of their topic/constraints, explain that video
directly and plainly, with no assumed background knowledge.
""",
        "build_first_message": lambda a: (
            f"I want to learn about {a.get('topic', 'this topic')}."
            + (f" {a['constraints']}" if a.get("constraints") else "")
            + " Find me the best YouTube video(s) for this."
            + _time_clause(a.get("time_constraint"))
        ),
    },
    "quiz": {
        "label": "Quiz Me",
        "emoji": "🎯",
        "popup": {"fields": ["video_url"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Quiz Me. The user has given you a specific video and wants to be
quizzed on it, not summarized. Use the transcription tool to pull real
facts from that exact video, then ask the user ONE question at a time
grounded in the transcript. Wait for their answer before asking the next
question, and tell them whether they were right and why.
""",
        "build_first_message": lambda a: f"Quiz me on this video: {a.get('video_url', '')}",
    },
    "sermons": {
        "label": "Sermons",
        "emoji": "🙏",
        "popup": {"fields": ["topic_choice", "preacher", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Sermons. The user wants a Christian sermon on a specific topic,
optionally from a specific preacher. Search YouTube for a sermon that
substantively addresses the requested topic, from a real, legitimate
ministry or preacher's channel. If a specific preacher was requested,
prioritize finding genuine content from that preacher — never misattribute
a sermon to the wrong speaker. If none was requested, pick any credible,
well-regarded source. Be respectful and accurate throughout.
""",
        "build_first_message": lambda a: _build_sermon_message(a),
    },
    "business": {
        "label": "Business, Finance & Investments",
        "emoji": "💼",
        "popup": {"fields": ["category", "creator", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Business, Finance & Investments. Five categories: Personal Finance
& Wealth Building (e.g. Graham Stephan, Caleb Hammer — budgeting, frugal
living, FIRE); Business Strategy & Entrepreneurship (e.g. Alex Hormozi,
Codie Sanchez, GaryVee — sales, marketing, startups, scaling); Institutional
Investment & Market Analysis (e.g. Meet Kevin, Joseph Carlson — stock
market, real estate, technical analysis, economic policy); Alternative
Assets & Web3 Finance (e.g. Coin Bureau, Benjamin Cowen — crypto, Bitcoin/
Ethereum, speculative trading); Corporate Documentaries & Economic Essays
(e.g. MagnatesMedia, ColdFusion, Jake Tran — corporate post-mortems,
economic history, business fraud deep dives). If the user named a specific
category or creator, prioritize genuinely matching that.
""",
        "build_first_message": lambda a: _build_business_message(a),
    },
    "tech": {
        "label": "Tech & Consumer Electronics",
        "emoji": "📱",
        "popup": {"fields": ["topic_choice", "creator", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Tech & Consumer Electronics. Covers smartphone/ecosystem reviews,
future tech & AI explanations, custom PC builds & desk setups, and EV/
automotive tech — in the style of MKBHD, Linus Tech Tips, Mrwhosetheboss,
Unbox Therapy. If the user named a specific creator, prioritize genuinely
matching that; otherwise find a well-regarded, current review or
explainer.
""",
        "build_first_message": lambda a: _build_topic_choice_message(a, "Find me a video"),
    },
    "productivity": {
        "label": "Productivity & Lifestyle Design",
        "emoji": "⚡",
        "popup": {"fields": ["topic_choice", "creator", "time_constraint"]},
        "system_prompt": BASE_PERSONA
        + """

MODE: Productivity & Lifestyle Design. Covers habit loops & time
management, study/work workflows, digital organization & app reviews, and
evidence-based health & focus optimization — in the style of Ali Abdaal,
Thomas Frank, Andrew Huberman, Matt D'Avella. If the user named a specific
creator, prioritize genuinely matching that; otherwise find a genuinely
actionable, well-regarded video.
""",
        "build_first_message": lambda a: _build_topic_choice_message(a, "Find me a video"),
    },
}


def build_first_message(mode_id, answers):
    """Looks up a mode by id and builds its first message from the popup
    answers dict. Returns "" if mode_id isn't a real mode."""
    mode = MODES.get(mode_id)
    if not mode:
        return ""
    return mode["build_first_message"](answers or {})
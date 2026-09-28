"""
Bob's Anna Executa plugin.

`chat` runs under `tools.invokeAsync` instead of plain `tools.invoke` — no
90-second ceiling, and `_emit_progress()` pushes the same "Bob is
thinking… / searching YouTube… / perfecting it…" status line the frontend's
typing indicator / fact-bubble / percentage UI reads.

============================================================================
MINIMAL PATCH NOTE — this is the ONLY thing that changed vs. the original
============================================================================
Two things were structurally broken, confirmed against Anna's own docs:

1. main() never answered the "initialize" JSON-RPC method. Per Anna's
   lifecycle docs: a plugin that doesn't answer initialize gets silently
   downgraded to protocol v1 by the Agent, and v1 plugins "lose access to
   all reverse-RPC features (sampling, storage, future logging/progress)".
   Every _emit_progress call was writing into a channel that could not
   exist without this handler. Added below, inside main()'s dispatch.

2. _emit_progress used the wrong wire format:
     - method was the bare string "progress" — the real method name is
       "executa/progress".
     - correlation was a top-level "invoke_id" key — the real contract
       correlates via params.context.invoke_id (nested).
     - the notification's own top-level "type" field only accepts
       "progress" or "tool_update" — anything else gets coerced by the
       host. Fixed below, while keeping the frontend-facing
       {type: "status", text} shape exactly as-is (now nested one level
       deeper, inside params.data), so useAnnaAgentStream.js needs zero
       changes.

Nothing else in this file was touched — same MANIFEST, same feedback-to-
local-file behavior, same everything else you already have.
============================================================================
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

import json
import base64
import asyncio
import threading
import traceback

# Credentials your modules read via os.getenv() — same names as your .env.
CREDENTIAL_NAMES = [
    "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY", "GROQ_API_KEY", "DEEPGRAM_API_KEY",
    "QDRANT_URL", "QDRANT_API_KEY", "PROXY_NAME", "PROXY_PASSWORD",
    "LANGSMITH_API_KEY", "FIRECRAWL_API_KEY",
    # server.py reads these with os.environ[...] at import time, so a missing
    # one crashes `import main` — and therefore every chat call.
    "B2_BUCKET_NAME", "B2_KEY_ID", "B2_APPLICATION_KEY", "B2_ENDPOINT",
]

# Required = the plugin cannot load without them.
REQUIRED_CREDENTIALS = (
    "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY",
    "B2_BUCKET_NAME", "B2_KEY_ID", "B2_APPLICATION_KEY", "B2_ENDPOINT",
)

MANIFEST = {
    "name": "tool-ai-ilaye-my-first-anna-app-y4u6ymnc",
    "version": "0.3.1",
    "credentials": [
        {"name": n, "required": n in REQUIRED_CREDENTIALS, "sensitive": True}
        for n in CREDENTIAL_NAMES
    ],
    "tools": [
        {
            "name": "chat",
            "description": "Send a message to Bob (optionally with a mode) and get a reply. Long-running — call via tools.invokeAsync, not tools.invoke.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "mode": {"type": "string"},
                    "mode_answers": {"type": "object"},
                    "thread_id": {"type": "string"},
                },
            },
        },
        {"name": "stt", "description": "Transcribe a base64-encoded audio blob.",
         "parameters": {"type": "object", "properties": {"audio_b64": {"type": "string"}}, "required": ["audio_b64"]}},
        {"name": "tts", "description": "Generate speech audio for a piece of text.",
         "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
        {"name": "feedback", "description": "Store free-text user feedback.",
         "parameters": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
    ],
}

_bob = None  # lazily populated: {"default_agent":..., "mode_agents":..., "build_first_message":...}


def _ensure_bob_loaded(credentials: dict):
    """First call only: inject credentials into os.environ, then import
    main.py so its module-level agent construction sees real keys."""
    global _bob
    if _bob is not None:
        return _bob

    for name in CREDENTIAL_NAMES:
        value = (credentials or {}).get(name)
        if value:
            os.environ[name] = value
        # else: leave whatever local-dev .env already set, untouched

    import main as bob_main
    from modes import build_first_message

    _bob = {
        "default_agent": bob_main.app,
        "mode_agents": bob_main.mode_agents,
        "build_first_message": build_first_message,
    }
    return _bob


# --- Progress emission — FIXED wire format, see the patch note above -------

def _emit_progress(invoke_id, data):
    """Sends an `executa/progress` notification correlated via
    params.context.invoke_id. Never raises — a broken progress channel
    should never take down the actual chat response."""
    if not invoke_id:
        return
    try:
        sys.stdout.write(json.dumps({
            "jsonrpc": "2.0",
            "method": "executa/progress",                 # was: "progress"
            "params": {
                "type": "tool_update",                     # required: "progress" or "tool_update" only
                "data": data,                               # your {type:"status", text:...} shape, unchanged
                "context": {"invoke_id": invoke_id},        # was: top-level "invoke_id"
            },
        }) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


# Friendly status phrases shown while Bob is working, keyed by which tool
# just started running. Add an entry here any time you add a new tool.
# Matches the tool names actually imported in main.py today.
TOOL_STATUS = {
    "run_with_timeout": "Bob is searching YouTube…",
    "transcription": "Bob is digging through the transcript…",
    "call_transcription_agent": "Bob is digging through the transcript…",
    "call_transcriber_agent": "Bob is digging through the transcript…",
    "web_search": "Bob is checking the web…",
    "meta_data": "Bob is checking video details…",
}
DEFAULT_TOOL_STATUS = "Bob is working on it…"


def handle_chat(args: dict, credentials: dict, invoke_id) -> dict:
    bob = _ensure_bob_loaded(credentials)

    mode_id = args.get("mode")
    mode_answers = args.get("mode_answers")
    thread_id = args.get("thread_id", "default")

    if mode_id and mode_answers is not None:
        user_text = bob["build_first_message"](mode_id, mode_answers)
    else:
        user_text = args.get("text", "")

    if not user_text:
        return {"success": False, "error": "Empty message."}
    if len(user_text) > 2000:
        return {"success": False, "error": f"Message too long ({len(user_text)} chars) — keep it under 2000."}

    agent_graph = bob["mode_agents"].get(mode_id, bob["default_agent"])
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 35}

    # last_status is what the heartbeat re-sends. Real events update it;
    # the heartbeat just keeps re-announcing it so the client never goes
    # more than HEARTBEAT_SECONDS without hearing from us — including
    # during the silent gaps (LLM "thinking" between tool calls) that
    # on_tool_start / on_chain_end alone don't cover, which is what was
    # still tripping wait_timeout even after progress started working.
    HEARTBEAT_SECONDS = 8
    last_status = {"text": "Bob is thinking…"}
    _emit_progress(invoke_id, {"type": "status", "text": last_status["text"]})

    stop_heartbeat = threading.Event()

    def _heartbeat():
        while not stop_heartbeat.wait(HEARTBEAT_SECONDS):
            _emit_progress(invoke_id, {"type": "status", "text": last_status["text"]})

    hb_thread = threading.Thread(target=_heartbeat, daemon=True)
    hb_thread.start()

    from langchain_core.messages import HumanMessage

    final_text = ""
    state = {"sent_perfecting": False, "root_run_id": None}

    async def _run():
        nonlocal final_text
        async for event in agent_graph.astream_events(
            {"messages": [HumanMessage(content=user_text)]}, config=config, version="v2"
        ):
            if state["root_run_id"] is None:
                state["root_run_id"] = event.get("run_id")

            kind = event.get("event")

            if kind == "on_tool_start":
                phrase = TOOL_STATUS.get(event.get("name"), DEFAULT_TOOL_STATUS)
                last_status["text"] = phrase
                _emit_progress(invoke_id, {"type": "status", "text": phrase})

            elif kind == "on_chain_end" and event.get("run_id") == state["root_run_id"]:
                if not state["sent_perfecting"]:
                    last_status["text"] = "Bob is perfecting it…"
                    _emit_progress(invoke_id, {"type": "status", "text": "Bob is perfecting it…"})
                    state["sent_perfecting"] = True

                output = event.get("data", {}).get("output", {})
                messages = output.get("messages", []) if isinstance(output, dict) else []
                if messages:
                    content = getattr(messages[-1], "content", "")
                    if content:
                        final_text = content

    try:
        asyncio.run(_run())
    finally:
        stop_heartbeat.set()

    return {
        "success": True,
        "data": {
            "text": final_text,
            "user_text": user_text if (mode_id and mode_answers is not None) else None,
        },
    }


def handle_stt(args: dict, credentials: dict) -> dict:
    _ensure_bob_loaded(credentials)
    from stt import process_audio

    audio_bytes = base64.b64decode(args["audio_b64"])
    try:
        text, _playback, _mime = asyncio.run(process_audio(audio_bytes))
        return {"success": True, "data": {"text": text}}
    except ValueError as e:
        return {"success": False, "error": str(e)}


def handle_tts(args: dict, credentials: dict) -> dict:
    _ensure_bob_loaded(credentials)
    from tts import generate_speech
    audio_bytes = generate_speech(args["text"])
    audio_b64 = base64.b64encode(audio_bytes).decode("ascii") if audio_bytes else ""
    return {"success": True, "data": {"audio_b64": audio_b64}}


def handle_feedback(args: dict, credentials: dict) -> dict:
    from datetime import datetime, timezone
    text = (args.get("text") or "").strip()
    if not text:
        return {"success": False, "error": "Feedback can't be empty."}
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "text": text}
    with open("user_feedback.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return {"success": True, "data": {"ok": True}}


HANDLERS = {"stt": handle_stt, "tts": handle_tts, "feedback": handle_feedback}


def invoke(method: str, args: dict, credentials: dict, invoke_id=None) -> dict:
    try:
        if method == "chat":
            return handle_chat(args, credentials, invoke_id)
        handler = HANDLERS.get(method)
        if not handler:
            return {"success": False, "error": f"unknown method: {method}"}
        return handler(args, credentials)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)  # captured into traces, per the Credentials doc
        return {"success": False, "error": str(e)}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            if req.get("method") == "describe":
                result = MANIFEST
            elif req.get("method") == "health":
                result = {"status": "ready"}
            elif req.get("method") == "initialize":
                # ADDED — without this, the Agent silently falls back to
                # protocol v1 and _emit_progress writes into a channel that
                # doesn't exist. This is the actual fix.
                result = {
                    "protocolVersion": "2.0",
                    "server_info": {"name": MANIFEST["name"], "version": MANIFEST["version"]},
                    "capabilities": {},
                }
            elif req.get("method") == "invoke":
                params = req["params"]
                credentials = (params.get("context") or {}).get("credentials") or {}
                # Best-guess extraction — see the file-level warning. Falls
                # back through three likely locations, then to the request's
                # own JSON-RPC id as a last resort correlator.
                invoke_id = (
                    params.get("invoke_id")
                    or (params.get("context") or {}).get("invoke_id")
                    or req.get("id")
                )
                result = invoke(params["tool"], params.get("arguments", {}), credentials, invoke_id)
            else:
                raise ValueError(f"unknown rpc: {req.get('method')}")
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req.get("id"), "result": result}) + "\n")
        except Exception as e:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": req.get("id"),
                                          "error": {"code": -32601, "message": str(e)}}) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

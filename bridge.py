"""
Bridge between your existing LangGraph app (main.py) and the React frontend.

This does NOT replace main.py — it imports the `app` and `mode_agents`
objects you build there and exposes them over a WebSocket so a browser can
talk to them, since Chainlit was doing that job before.

This file belongs in the SAME folder as main.py, modes.py, transcription.py,
search.py, and .env — not in a subfolder — so the imports below just work
without any package path juggling.

Run from that folder, alongside your frontend:
    uvicorn bridge:api --reload --port 8000
"""

import base64
import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from langchain_core.messages import HumanMessage

# --- Import your compiled LangGraph agents ----------------------------------
# `app` = default Bob, `mode_agents` = one pre-built agent per mode, both
# sharing the same checkpointer (see the main.py addition for why that
# matters). Rename `main` to match your actual module path if needed.
from main import app as default_agent, mode_agents

# --- Import your mode prompt-construction logic ------------------------------
from modes import build_first_message

# --- Import your existing speech-to-text pipeline ---------------------------
# process_audio(bytes) -> (text, playback_audio, playback_mime); raises
# ValueError for anything that fails your own size/silence checks.
from stt import process_audio

# --- Import the Deepgram text-to-speech wrapper (Live Call only) -----------
from tts import generate_speech

import asyncio
from datetime import datetime, timezone

from pydantic import BaseModel
from langsmith import Client as LangSmithClient


class TTSRequest(BaseModel):
    text: str


class FeedbackRequest(BaseModel):
    run_id: str
    score: int  # 1 = thumbs up, 0 = thumbs down


_langsmith_client = None


def _get_langsmith_client():
    global _langsmith_client
    if _langsmith_client is None:
        # Reads LANGSMITH_API_KEY from your .env automatically — no extra
        # config needed since your tracing setup already relies on it.
        _langsmith_client = LangSmithClient()
    return _langsmith_client


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("bridge")

# Raised from LangGraph's default of 25 — gives real multi-step queries (a
# few searches, a retry, a transcript pull) enough headroom. If you're
# hitting this again after also adding retry-with-backoff in
# transcript.py, that's a sign of an actual stuck loop, not just proxy
# flakiness, and is worth a LangSmith trace to see which tool keeps firing.
GRAPH_RECURSION_LIMIT = 35

# Defense against someone pasting a huge wall of text at the agent — this
# is the server-side backstop; the frontend also caps the textarea at the
# same number so most people never even see the rejection.
MAX_MESSAGE_CHARS = 2000

# Natural-language feedback (the "?" menu's Feedback item) — appended as one
# JSON line per submission. Works great on a normal VPS/EC2 with persistent
# disk; if you ever move to a host that wipes local files on redeploy, swap
# this for something durable (a sheet, a database, an email) instead.
FEEDBACK_LOG_PATH = "user_feedback.jsonl"


class TextFeedbackRequest(BaseModel):
    text: str

api = FastAPI(title="QuestoHive Bridge")

api.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "*"  # The wildcard allows requests from your Ngrok URL and local IP
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.post("/api/stt")
async def speech_to_text(file: UploadFile = File(...)):
    """
    Accepts a recorded audio blob from the mic button, transcribes it via
    your existing process_audio() (Groq Whisper), and returns plain text.

    Intentionally does NOT touch the conversation/agent at all — the
    frontend drops the returned text into the input box for the user to
    edit before sending, it's never auto-sent.
    """
    audio_bytes = await file.read()
    try:
        text, _playback_audio, _playback_mime = await process_audio(audio_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Transcription failed")
        raise HTTPException(status_code=500, detail="Transcription failed. Try typing instead.")

    return {"text": text}


@api.post("/api/tts")
async def text_to_speech(req: TTSRequest):
    """
    Generates audio for a single already-arrived message — used by the
    small play-as-audio button on each of Bob's replies. Deliberately not
    tied to the call flow: this just takes text, returns audio, done.
    """
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="No text provided.")
    try:
        audio_bytes = await asyncio.to_thread(generate_speech, req.text)
        audio_b64 = base64.b64encode(audio_bytes).decode("ascii") if audio_bytes else ""
    except Exception:
        logger.exception("TTS generation failed")
        raise HTTPException(status_code=500, detail="Couldn't generate audio for this message.")

    return {"audio_b64": audio_b64}


@api.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest):
    """
    Attaches a thumbs up/down score directly to the LangSmith run that
    produced a given reply — not a separate database. Since run_id
    identifies the exact trace, this shows up on that trace's page in the
    LangSmith dashboard, with everything else (tools called, timing) still
    right there for context.
    """
    if not req.run_id:
        raise HTTPException(status_code=400, detail="Missing run_id.")
    try:
        client = _get_langsmith_client()
        await asyncio.to_thread(
            client.create_feedback,
            run_id=req.run_id,
            # For a root-level run (this is always the whole agent turn, not
            # a sub-step), trace_id == run_id. Passing it explicitly skips
            # the deprecated "look up the session for this run" path — the
            # likely actual source of the httpx connection error, not just
            # the warning.
            trace_id=req.run_id,
            key="user_rating",
            score=req.score,
        )
    except Exception:
        logger.exception("Failed to send feedback to LangSmith")
        raise HTTPException(status_code=500, detail="Couldn't record feedback.")

    return {"ok": True}


@api.post("/api/feedback-text")
async def submit_text_feedback(req: TextFeedbackRequest):
    """
    Free-text feedback from the '?' menu — separate from the per-message
    thumbs up/down (which goes to LangSmith). This isn't tied to any
    specific reply, so it just gets appended to a local log file instead.
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Feedback can't be empty.")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Please keep feedback under 1000 characters.")

    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "text": text}
    try:
        with open(FEEDBACK_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        logger.exception("Failed to write feedback to disk")
        raise HTTPException(status_code=500, detail="Couldn't save feedback right now.")

    return {"ok": True}


# Friendly status phrases shown while Bob is working, keyed by which tool
# just started running. Add an entry here any time you add a new tool.
TOOL_STATUS = {
    "run_with_timeout": "Bob is searching YouTube…",
    "transcription": "Bob is searching YouTube…",
    "call_transcription_agent": "Bob is digging through the transcript…",
    "call_transcripber_agent": "Bob is digging through the transcript…",
    "web_agent": "Bob is checking what's trending…",
}
DEFAULT_TOOL_STATUS = "Bob is working on it…"


async def run_agent_with_status(agent_graph, user_text, config, websocket):
    """
    Runs the agent using LangGraph's EVENT stream (astream_events), not raw
    token streaming. This is what fixes the "messy" streaming problem: we
    never show the model's in-between tool-calling chatter to the user at
    all. Instead we:
      - send a friendly status line each time a tool starts running
      - wait for the whole run to finish
      - send the actual final answer as ONE complete block at the end

    Returns the final answer text.
    """
    await websocket.send_text(json.dumps({"type": "status", "text": "Bob is thinking…"}))

    root_run_id = None
    final_text = ""
    sent_perfecting = False

    async for event in agent_graph.astream_events(
        {"messages": [HumanMessage(content=user_text)]},
        config=config,
        version="v2",
    ):
        # Debug aid: uncomment to see every event this graph actually emits,
        # if the statuses below don't show up or the final text stays empty.
        # print(event.get("event"), event.get("name"), event.get("run_id"))

        if root_run_id is None:
            root_run_id = event.get("run_id")

        kind = event.get("event")

        if kind == "on_tool_start":
            phrase = TOOL_STATUS.get(event.get("name"), DEFAULT_TOOL_STATUS)
            await websocket.send_text(json.dumps({"type": "status", "text": phrase}))

        elif kind == "on_chain_end" and event.get("run_id") == root_run_id:
            if not sent_perfecting:
                await websocket.send_text(json.dumps({"type": "status", "text": "Bob is perfecting it…"}))
                sent_perfecting = True

            output = event.get("data", {}).get("output", {})
            messages = output.get("messages", []) if isinstance(output, dict) else []
            if messages:
                content = getattr(messages[-1], "content", "")
                if content:
                    final_text = content

    return final_text, root_run_id


@api.websocket("/ws/chat")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()

    # One thread_id per browser tab keeps LangGraph checkpointing separate
    # per conversation. Pass ?thread_id=xyz from the frontend if you want
    # persistence across reloads; otherwise it falls back to "default".
    thread_id = websocket.query_params.get("thread_id", "default")
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": GRAPH_RECURSION_LIMIT}

    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)

            # A normal typed message has "text". A mode-triggered message
            # instead sends "mode" + "mode_answers" (from the Phase 2 UI,
            # not built yet) — bridge.py builds the real first message from
            # those answers using modes.py, so all the prompt wording stays
            # in Python, not JavaScript.
            mode_id = payload.get("mode")
            mode_answers = payload.get("mode_answers")

            if mode_id and mode_answers is not None:
                user_text = build_first_message(mode_id, mode_answers)
            else:
                user_text = payload.get("text", "")

            if not user_text:
                continue

            if len(user_text) > MAX_MESSAGE_CHARS:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "text": f"That message is too long ({len(user_text)} characters) — please keep it under {MAX_MESSAGE_CHARS}.",
                        }
                    )
                )
                continue

            agent_graph = mode_agents.get(mode_id, default_agent)

            # If this message was mode-generated, echo the actual text back
            # so the frontend can show it as the user's message bubble —
            # the user never typed it themselves, so the UI needs to be told
            # what was actually sent.
            if mode_id and mode_answers is not None:
                await websocket.send_text(json.dumps({"type": "user_echo", "text": user_text}))

            await websocket.send_text(json.dumps({"type": "start"}))

            try:
                final_text, root_run_id = await run_agent_with_status(agent_graph, user_text, config, websocket)
            except Exception:
                logger.exception("Agent graph raised while running")
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "text": "Something went wrong on the agent side. Try again.",
                        }
                    )
                )
                continue

            await websocket.send_text(
                json.dumps({"type": "end", "text": final_text, "run_id": str(root_run_id) if root_run_id else None})
            )

    except WebSocketDisconnect:
        logger.info("Client disconnected: thread_id=%s", thread_id)


@api.websocket("/ws/call")
async def call_ws(websocket: WebSocket):
    """
    Live Call: one turn at a time. The frontend already transcribed and got
    the user's confirmation before anything reaches here (via /api/stt) —
    this endpoint just receives the final confirmed text (or a mode's
    crafted opening line), runs the right agent, and sends back the reply
    as text PLUS synthesized audio.

    Uses the SAME default thread_id fallback as /ws/chat, so a call and a
    regular chat share conversation history automatically as long as
    neither side overrides ?thread_id= with something different.
    """
    await websocket.accept()

    thread_id = websocket.query_params.get("thread_id", "default")
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": GRAPH_RECURSION_LIMIT}

    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)

            mode_id = payload.get("mode")
            mode_answers = payload.get("mode_answers")

            if mode_id and mode_answers is not None:
                user_text = build_first_message(mode_id, mode_answers)
            else:
                user_text = payload.get("text", "")

            if not user_text:
                continue

            if len(user_text) > MAX_MESSAGE_CHARS:
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "error",
                            "text": f"That message is too long ({len(user_text)} characters) — please keep it under {MAX_MESSAGE_CHARS}.",
                        }
                    )
                )
                continue

            agent_graph = mode_agents.get(mode_id, default_agent)

            if mode_id and mode_answers is not None:
                await websocket.send_text(json.dumps({"type": "user_echo", "text": user_text}))

            try:
                final_text, root_run_id = await run_agent_with_status(agent_graph, user_text, config, websocket)
            except Exception:
                logger.exception("Agent graph raised during call turn")
                await websocket.send_text(
                    json.dumps({"type": "error", "text": "Something went wrong. Try again."})
                )
                continue

            # TTS runs in a thread since the Deepgram SDK call is blocking —
            # same reason process_audio() uses asyncio.to_thread in /api/stt.
            try:
                audio_bytes = await asyncio.to_thread(generate_speech, final_text)
                audio_b64 = base64.b64encode(audio_bytes).decode("ascii") if audio_bytes else ""
            except Exception:
                logger.exception("TTS generation failed — sending text-only reply")
                audio_b64 = ""

            await websocket.send_text(
                json.dumps({"type": "call_reply", "text": final_text, "audio_b64": audio_b64})
            )

    except WebSocketDisconnect:
        logger.info("Call client disconnected: thread_id=%s", thread_id)
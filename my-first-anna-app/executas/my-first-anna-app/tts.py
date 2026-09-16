"""
Text-to-speech via Deepgram, used only during Live Call turns.

generate_speech(text) -> bytes (mp3 audio for the given text)

Kept deliberately simple: waits for the full clip, returns it whole. If
call latency ever feels sluggish, this is the one function to revisit for
chunked/streamed audio instead — nothing else in bridge.py needs to change
to support that later.
"""

import os

from deepgram import DeepgramClient

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY")

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = DeepgramClient(api_key=DEEPGRAM_API_KEY)
    return _client


def generate_speech(text: str, model: str = "flux-cliff-en") -> bytes:
    """Returns the full mp3 audio for `text` as raw bytes. Returns empty
    bytes for empty/whitespace-only input rather than calling the API."""
    if not text or not text.strip():
        return b""

    client = _get_client()
    audio = bytearray()
    for chunk in client.speak.v2.audio.generate(
        text=text,
        model=model,
        speed=1,
        expressivity=0,
    ):
        audio.extend(chunk)
    return bytes(audio)
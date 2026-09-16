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

CREDENTIAL_NAMES = [
    "DEEPSEEK_API_KEY", "YOUTUBE_API_KEY", "GROQ_API_KEY", "DEEPGRAM_API_KEY",
    "QDRANT_URL", "QDRANT_API_KEY", "PROXY_NAME", "PROXY_PASSWORD",
    "LANGSMITH_API_KEY", "FIRECRAWL_API_KEY",
]

_bob = None

def _ensure_bob_loaded(credentials: dict):
    global _bob
    if not _bob is not None:
        return _bob

    for name in CREDENTIAL_NAMES:
        value = (cred  entials)
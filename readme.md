# Wiring the UI to your `main.py`

## What each piece is, using your actual files

Here's the full picture with `main.py`, `transcription.py`, `search.py`, and `.env` —
your existing project — shown alongside everything new. This is your whole folder:

```
questohive/                    ← your project root (already exists)
├── main.py                       existing — defines `app = supervisor.compile()`
├── transcription.py              existing
├── search.py                     existing
├── .env                          existing
├── bridge.py                     NEW — goes here, next to main.py (see why below)
│
└── questohive-ui/                NEW — the whole frontend lives in this one subfolder
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── index.css
        ├── App.jsx               the UI you saw in the demo, now real-data-driven
        ├── hooks/
        │   ├── useAgentStream.js owns the WebSocket connection
        │   └── useVoiceInput.js  owns the mic button + recording
        └── lib/
            └── youtube.js        URL parsing shared by the UI
```

**About `useVoiceInput.js` specifically:** you don't need to write or change anything
in it. It just needs to sit in `questohive-ui/src/hooks/`, next to `useAgentStream.js`.
`App.jsx` already imports and uses it — once the file is in the right folder, the mic
button in the app works on its own.

Two rules of thumb:
- **`bridge.py` sits directly next to `main.py`** (same folder, not a subfolder) —
  that's what lets it do `from main import app` with zero path configuration.
  `transcription.py` and `search.py` don't need to move or change at all; `main.py`
  already imports from them the way it does today.
- **Everything frontend-related lives inside `questohive-ui/`** as one self-contained
  subfolder. Nothing in there touches your Python files directly — the WebSocket is
  the only connection between the two sides.

`questohive_youtube_ui.jsx` (the single-file demo from earlier) isn't part of either
of these — it's a standalone visual reference, not wired into the running app.

**So no, this isn't the only module** — a deployable app needs everything in the tree
above: your three existing Python files, the new `bridge.py`, and the whole
`questohive-ui/` folder. Splitting `App.jsx` further into `components/ChatPane.jsx`,
`WatchPanel.jsx`, `VideoCard.jsx` etc. is a clean follow-up once you're comfortable
with the structure, but it isn't required to run.

## Connecting to your `main.py`

Your `main.py` already does the important part — it builds `app = supervisor.compile()`.
`bridge.py`, sitting right next to it, imports that exact object and puts a WebSocket
in front of it:

```python
from main import app as agent_graph
```

Because both files are in the same folder, that import works as-is — no path changes
needed. The bridge calls `agent_graph.astream(...)` for each incoming message and
forwards the growing response back over the socket — that's the part that used to be
Chainlit's job.

## Running it locally

**Backend** (from `questohive/`, the folder containing `main.py` and `bridge.py`):
```bash
pip install fastapi uvicorn[standard]
uvicorn bridge:api --reload --port 8000
```

**Frontend**:
```bash
cd questohive-ui
npm install
npm run dev
```

Open `http://localhost:5173`. Send a message — it goes out over the WebSocket to
`ws://localhost:8000/ws/chat`, your LangGraph supervisor runs, and whatever it
returns (including YouTube URLs) streams back and renders — Watch panel opens
automatically the moment a `youtube.com` or `youtu.be` link shows up.

## Two things to double check on your side

1. **Streaming shape** — `bridge.py` assumes `agent_graph.astream(..., stream_mode="values")`
   yields `{"messages": [...]}` with the latest AI message's `.content` as plain text.
   If your supervisor's output shape differs (e.g. nested under a specific agent key),
   adjust the `event.get("messages", [])` line accordingly.
2. **Timestamp pills (optional, skip for now)** — under each video, there's room for
   small clickable buttons like "0:30 · Intro" that jump the video to that moment.
   That part isn't turned on yet — it needs a small code change to feed it your
   transcript data, which is a "let's do this together later" item, not something to
   worry about today. Everything else works fully without it.

## What changed in this round

- **Video sidebar (desktop):** every unique video shared in the conversation is now kept
  in `videoHistory` and never dropped — sending a new message no longer clears the
  preview. The sidebar only opens/closes via the "Videos" button at the top right of
  the header (it still auto-opens once, the very first time a video shows up).
- **Mobile:** each message now embeds its own real, playable video inline (not just a
  placeholder chip) the moment that message finishes arriving.
- **Send button:** shows a spinner and disables itself while Bob is responding, so
  double-sends aren't possible and there's a clear "yes, that was sent" signal.
- **Voice input:** the mic button next to the input records audio, sends it to
  `/api/stt`, and drops the transcribed text into the input box — never auto-sent.
  Recording auto-stops and shows a warning at exactly 1 minute; anything under that
  gets transcribed normally.

## Setting up voice input

1. `bridge.py` now imports `process_audio` from your `stt.py` — make sure `stt.py`
   sits in the same folder as `bridge.py` and `main.py` (per the layout above), and
   that `GROQ_API_KEY` is in your `.env`.
2. Install the one new backend dependency for file uploads:
   ```bash
   pip install python-multipart
   ```
3. **HTTPS note:** browsers only allow microphone access (`getUserMedia`) on
   `localhost` or over HTTPS — not on a plain HTTP domain. Local dev works as-is;
   once you deploy, make sure your frontend is served over `https://`.
4. The 25MB check is enforced server-side inside your `process_audio`, as before.
   The 1-minute cap is enforced client-side (before anything is even uploaded) — if
   you also want a server-side backstop, that'd mean inspecting audio duration in
   `stt.py`, which isn't in place yet.

## Deploying

- Frontend: `npm run build` in `questohive-ui/`, then deploy the `dist/` folder to
  Vercel or Netlify (drag-and-drop or connect the repo).
- Backend: deploy the whole `questohive/` folder (`main.py`, `transcription.py`,
  `search.py`, `bridge.py`, `.env`) the same way you'd deploy any FastAPI app — your
  existing EC2 instance works fine, just run it with `uvicorn bridge:api` behind a
  process manager instead of Chainlit.
- Update `VITE_WS_URL` in a `.env` file in `questohive-ui/` to point at your deployed
  backend's `wss://` URL before building for production.
  
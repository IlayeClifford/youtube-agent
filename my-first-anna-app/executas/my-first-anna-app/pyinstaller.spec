# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller --onedir spec for Bob (bob_plugin.py).

Modeled on Anna's own multifile-binary/python-pyinstaller-onedir example
(anna-executa-examples repo) — produces dist/my-first-anna-app/ containing
the launcher + all bundled shared libs. The GitHub Actions workflow then
re-arranges this into Anna's expected archive layout:

    bin/my-first-anna-app(.exe)   <- launcher, PyInstaller's _internal/ MUST
                                     stay right next to it (see build.sh
                                     comment in the real example — moving
                                     _internal/ elsewhere breaks the very
                                     first dlopen)
    manifest.json                 <- copied in from the static file checked
                                     into this same directory

--onedir (not --onefile) per Anna's own Common Pitfalls doc: a --onefile
binary re-extracts itself to a temp dir on every cold start, and on a
200MB+ bundle (which this will be, given fastembed/onnxruntime/langchain)
that can exceed the Agent's fixed 5s steady-state describe timeout.

NOT YET VERIFIED BY A REAL BUILD. This uses collect_all for every package
in this project's dependency tree that's commonly known to need it
(dynamic plugin/entry-point loading, compiled extensions PyInstaller's
static analysis can miss). Expect at least one iteration: run the built
binary locally, and if it exits with ModuleNotFoundError on first launch,
add that package to COLLECT_ALL_PACKAGES below and rebuild — this is
normal, not a sign anything here is wrong.

KNOWN GAP: b2sdk and curl_cffi appear in the current server.py (per the
"adjustments" mentioned but not shared in full) but were not present in
the last pyproject.toml this spec's author had on record. Both are
already listed in COLLECT_ALL_PACKAGES below on the assumption they're
now real dependencies — if pyproject.toml doesn't declare them yet, the
build's pip-install step fails first, before PyInstaller ever runs.
"""

from PyInstaller.utils.hooks import collect_all

block_cipher = None

# Packages known (or likely, given this project's dependency list) to need
# collect_all rather than PyInstaller's default static import scan --
# either because they load plugins/providers dynamically (grpc, onnxruntime,
# langchain's provider registry) or ship compiled binaries alongside Python
# (fastembed/onnxruntime's .so/.dll/.pyd, curl_cffi's vendored libcurl).
COLLECT_ALL_PACKAGES = [
    "grpc",
    "qdrant_client",
    "fastembed",
    "onnxruntime",
    "tokenizers",
    "huggingface_hub",
    "langchain",
    "langchain_core",
    "langchain_community",
    "langchain_deepseek",
    "langchain_qdrant",
    "langchain_tavily",
    "langchain_huggingface",
    "tiktoken",
    "googleapiclient",
    "google_auth_httplib2",
    "deepgram",
    "groq",
    "boto3",
    "botocore",
    "b2sdk",       # see KNOWN GAP above
    "curl_cffi",   # see KNOWN GAP above
    "yt_dlp",
]

datas = []
binaries = []
hiddenimports = []

for pkg in COLLECT_ALL_PACKAGES:
    pkg_datas, pkg_binaries, pkg_hiddenimports = collect_all(pkg)
    datas += pkg_datas
    binaries += pkg_binaries
    hiddenimports += pkg_hiddenimports

a = Analysis(
    ["bob_plugin.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="my-first-anna-app",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="my-first-anna-app",
)

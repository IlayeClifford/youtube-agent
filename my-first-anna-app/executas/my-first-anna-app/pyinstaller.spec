# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller onedir build for the Bob Executa plugin.

Keep this spec deliberately narrow. Broad collect_all() calls for LangChain,
Hugging Face, boto3, and related packages pull in optional integrations,
tests, and command-line tools and can cause the GitHub runner to be killed
while building COLLECT.
"""

from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
)

block_cipher = None

datas = []
binaries = []
hiddenimports = []


def collect_runtime_files(package_name: str) -> None:
    """Collect package data and native libraries without all submodules."""
    datas.extend(collect_data_files(package_name))
    binaries.extend(collect_dynamic_libs(package_name))


# These packages contain model/provider data or native libraries that are not
# always found by static analysis. Do not use collect_all() here.
for package_name in (
    "fastembed",
    "onnxruntime",
    "qdrant_client",
    "curl_cffi",
    "yt_dlp",
):
    collect_runtime_files(package_name)

# Only these package subtrees are loaded dynamically by the application.
hiddenimports.extend(collect_submodules("fastembed"))
hiddenimports.extend(collect_submodules("qdrant_client.grpc"))

# Application modules loaded by bob_plugin/main.
hiddenimports += [
    "bob_plugin",
    "main",
    "modes",
    "transcript",
    "search",
    "web_search",
    "metadata",
    "server",
    "stt",
    "tts",

    # LangChain integrations used by main.py.
    "langchain.agents",
    "langchain.agents.middleware",
    "langchain_core.messages",
    "langchain_core.runnables",
    "langchain_core.tools",
    "langchain_deepseek",
    "langchain_tavily",
    "langchain_qdrant",
    "langchain_huggingface",
    "langchain_community.embeddings.fastembed",

    # Qdrant/gRPC generated modules.
    "grpc",
    "grpc._cython._cygrpc",
    "qdrant_client.grpc.collections_pb2",
    "qdrant_client.grpc.collections_pb2_grpc",
    "qdrant_client.grpc.json_with_int_pb2",
    "qdrant_client.grpc.json_with_int_pb2_grpc",
    "qdrant_client.grpc.points_pb2",
    "qdrant_client.grpc.points_pb2_grpc",
    "qdrant_client.grpc.qdrant_common_pb2",
    "qdrant_client.grpc.qdrant_common_pb2_grpc",

    # Google API modules used by search.py and metadata.py.
    "googleapiclient.discovery",
    "googleapiclient.errors",
    "google_auth_httplib2",

    # Runtime integrations used by the application.
    "deepgram",
    "groq",
    "boto3",
    "botocore",
    "b2sdk",
]

# Optional modules discovered by third-party hooks but not used by Bob.
excludes = [
    "langchain.mcp",
    "fastmcp",
    "torch.utils.tensorboard",
    "tensorboard",
    "pytest",
    "onnx",
    "onnxruntime.quantization",
    "onnxruntime.tools",
    "tensorflow",
    "MySQLdb",
    "pysqlite2",
]

a = Analysis(
    ["bob_plugin.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=excludes,
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

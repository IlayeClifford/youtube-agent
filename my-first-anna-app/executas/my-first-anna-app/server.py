import os
import shutil
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from langchain_core.tools import tool

import boto3
import yt_dlp
from botocore.config import Config
from boto3.s3.transfer import TransferConfig
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# Configuration
# ============================================================

BUCKET = os.environ["B2_BUCKET_NAME"]
PROXY_URL = os.getenv("PROXY_URL")
TRANSCODE_AUDIO_TO_MP3 = os.getenv("TRANSCODE_AUDIO_TO_MP3", "false").lower() == "true"
FORCE_IPV4 = os.getenv("YOUTUBE_FORCE_IPV4", "true").lower() == "true"

ARIA2C_PATH = shutil.which("aria2c")
FFMPEG_PATH = shutil.which("ffmpeg")
STREAM_PART_SIZE = 8 * 1024 * 1024  # 8MB minimum for B2 multipart

s3 = boto3.client(
    "s3",
    endpoint_url=os.getenv("B2_ENDPOINT"),
    aws_access_key_id=os.getenv("B2_KEY_ID"),
    aws_secret_access_key=os.getenv("B2_APPLICATION_KEY"),
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        max_pool_connections=32,
    ),
)

TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=8 * 1024 * 1024,
    multipart_chunksize=8 * 1024 * 1024,
    max_concurrency=16,
    use_threads=True,
)

# ============================================================
# yt-dlp Configuration
# ============================================================

def _base_ydl_opts(output_path: Path, file_id: str) -> dict:
    opts = {
        "outtmpl": str(output_path / f"{file_id}.%(ext)s"),
        "noplaylist": True,
        "concurrent_fragment_downloads": 8,
        "force_ipv4": FORCE_IPV4,
        "buffersize": 1024 * 1024,
        "socket_timeout": 15,
        "retries": 3,
        "fragment_retries": 3,
        "quiet": True,
        "no_warnings": True,
        "nopart": True,
        "merge_output_format": "mp4",
    }

    if ARIA2C_PATH:
        opts["external_downloader"] = "aria2c"
        opts["external_downloader_args"] = {
            "aria2c": ["-x", "16", "-s", "16", "-k", "1M"]
        }

    if PROXY_URL:
        opts["proxy"] = PROXY_URL

    return opts


def _final_filepath(ydl: yt_dlp.YoutubeDL, info: dict) -> Path:
    downloads = info.get("requested_downloads") or [info]
    entry = downloads[0]
    for key in ("filepath", "_filename"):
        if entry.get(key):
            return Path(entry[key])
    return Path(ydl.prepare_filename(info))

# ============================================================
# Audio Pipeline: Download & Parallel B2 Stream Upload
# ============================================================

def _upload_part_worker(bucket: str, key: str, upload_id: str, part_num: int, body: bytes) -> dict:
    resp = s3.upload_part(
        Bucket=bucket, Key=key, PartNumber=part_num, UploadId=upload_id, Body=body
    )
    return {"ETag": resp["ETag"], "PartNumber": part_num}


def download_and_upload_streaming(
    url: str,
    temp_dir: Path,
    expires_in: int = 3600,
) -> tuple[str, float, float]:
    file_id = uuid.uuid4().hex
    ctx = {
        "path": None,
        "ready": threading.Event(),
        "done": threading.Event(),
        "error": None,
        "file_key": None,
        "share_url": None,
        "upload_elapsed": None,
    }

    def hook(d):
        if ctx["path"] is None and d.get("filename"):
            ctx["path"] = Path(d["filename"])
            ctx["file_key"] = f"{file_id}-{ctx['path'].name}"
            ctx["ready"].set()

    def _stream_upload_worker():
        while not ctx["ready"].is_set():
            if ctx["done"].is_set():
                return
            ctx["ready"].wait(timeout=0.2)

        local_path: Path = ctx["path"]
        file_key: str = ctx["file_key"]
        upload_id = None
        futures = []
        uploaded = 0
        part_counter = 0
        start = time.perf_counter()

        try:
            upload_id = s3.create_multipart_upload(Bucket=BUCKET, Key=file_key)["UploadId"]

            with ThreadPoolExecutor(max_workers=8) as executor:
                while True:
                    size = local_path.stat().st_size if local_path.exists() else 0

                    if size - uploaded >= STREAM_PART_SIZE:
                        with open(local_path, "rb") as f:
                            f.seek(uploaded)
                            chunk = f.read(STREAM_PART_SIZE)
                        part_counter += 1
                        futures.append(
                            executor.submit(
                                _upload_part_worker, BUCKET, file_key, upload_id, part_counter, chunk
                            )
                        )
                        uploaded += len(chunk)
                        continue

                    if ctx["done"].is_set():
                        break
                    time.sleep(0.15)

                final_size = local_path.stat().st_size
                if final_size > uploaded:
                    with open(local_path, "rb") as f:
                        f.seek(uploaded)
                        chunk = f.read()
                    part_counter += 1
                    futures.append(
                        executor.submit(
                            _upload_part_worker, BUCKET, file_key, upload_id, part_counter, chunk
                        )
                    )
                    uploaded += len(chunk)

                parts = [f.result() for f in as_completed(futures)]

            if not parts:
                s3.abort_multipart_upload(Bucket=BUCKET, Key=file_key, UploadId=upload_id)
                return

            s3.complete_multipart_upload(
                Bucket=BUCKET,
                Key=file_key,
                UploadId=upload_id,
                MultipartUpload={"Parts": sorted(parts, key=lambda p: p["PartNumber"])},
            )

            ctx["share_url"] = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": BUCKET, "Key": file_key},
                ExpiresIn=expires_in,
            )

        except Exception as e:
            ctx["error"] = e
            if upload_id:
                try:
                    s3.abort_multipart_upload(Bucket=BUCKET, Key=file_key, UploadId=upload_id)
                except Exception:
                    pass
        finally:
            ctx["upload_elapsed"] = time.perf_counter() - start

    ydl_opts = _base_ydl_opts(temp_dir, file_id)
    ydl_opts["format"] = "bestaudio[ext=m4a]/bestaudio/best"
    ydl_opts["progress_hooks"] = [hook]

    upload_thread = threading.Thread(target=_stream_upload_worker, daemon=True)
    upload_thread.start()

    download_started = time.perf_counter()
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(url, download=True)
    finally:
        ctx["done"].set()
        upload_thread.join()

    download_elapsed = time.perf_counter() - download_started

    if ctx["error"]:
        raise RuntimeError(f"Streaming upload failed: {ctx['error']}") from ctx["error"]

    return ctx["share_url"], download_elapsed, ctx["upload_elapsed"] or 0.0

# ============================================================
# Video Pipeline: Single Pass Download + Automatic Muxing
# ============================================================

def download_media_video(url: str, temp_dir: Path) -> Path:
    if not FFMPEG_PATH:
        raise RuntimeError("ffmpeg is required to merge video/audio streams but was not found on PATH.")

    file_id = uuid.uuid4().hex
    ydl_opts = _base_ydl_opts(temp_dir, file_id)

    # Resolves both standard landscape and portrait YouTube Shorts up to 720p
    ydl_opts["format"] = "bv*[height<=720]+ba/bv*[width<=1080]+ba/bv*+ba/b"

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return _final_filepath(ydl, info)

# ============================================================
# Main Entry Point
# ============================================================

def download_and_share(url: str, media_type: str = "video") -> tuple[str, float, float]:
    total_start = time.perf_counter()

    with tempfile.TemporaryDirectory() as temp_dir_str:
        temp_dir = Path(temp_dir_str)

        if media_type == "audio" and not TRANSCODE_AUDIO_TO_MP3:
            share_url, download_time, upload_time = download_and_upload_streaming(url, temp_dir)
        else:
            d_start = time.perf_counter()
            local_path = download_media_video(url, temp_dir)
            download_time = time.perf_counter() - d_start

            u_start = time.perf_counter()
            file_key = f"{uuid.uuid4().hex}-{local_path.name}"
            s3.upload_file(str(local_path), BUCKET, file_key, Config=TRANSFER_CONFIG)
            upload_time = time.perf_counter() - u_start

            share_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": BUCKET, "Key": file_key},
                ExpiresIn=3600,
            )

    total_time = time.perf_counter() - total_start
    print(f"[{media_type.upper()}] Download: {download_time:.2f}s | Upload: {upload_time:.2f}s | Total: {total_time:.2f}s")

    return share_url, download_time, upload_time

# ============================================================
# LangChain Tool Entry Point
# ============================================================
@tool
def youtube_downloader_tool(url: str, download_type: str = "video") -> str:
    """Use this tool to download youtube shorts or audio file for audios less than 15 minutes and get a shareable link.
      Args:
          url: The URL of the YouTube video to download.
          download_type: The type of media to download ('video' or 'audio').
      Returns:
          A string containing the shareable link and download/upload stats."""
    download_type = download_type.lower().strip()
    if download_type not in {"video", "audio"}:
        raise ValueError("download_type must be 'video' or 'audio'")

    try:
        link, d_time, u_time = download_and_share(url, media_type=download_type)
        return (
            f"Here's your {download_type} file (expires in 1 hour):\n"
            f"Link: {link}\n"
            f"Stats: Downloaded in {d_time:.2f}s | Uploaded in {u_time:.2f}s"
        )
    except Exception as e:
        return f"Failed to download media: {e}"
    
import logging
if __name__ == "__main__":
    
    logging.basicConfig(level=logging.INFO)
    logging.info("Starting YouTube Downloader Tool Server...")
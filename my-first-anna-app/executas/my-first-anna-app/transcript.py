import os
import uuid
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig

from langchain_core.tools import tool
from langchain_core.documents import Document
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from fastembed import TextEmbedding
from langchain_core.embeddings import Embeddings
from typing import List
from pathlib import Path

load_dotenv()

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")

COLLECTION_NAME = "video_transcripts"
CHUNK_INTERVAL_SECONDS = 30  # single source of truth for chunk window size


class FastEmbedEmbeddings(Embeddings):
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        cache_dir = Path.home() / ".cache" / "fastembed"
        cache_dir.mkdir(parents=True, exist_ok=True)
        self._model = TextEmbedding(
            model_name=model_name,
            cache_dir=str(cache_dir),
            local_files_only=False,
        )

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [vector.tolist() for vector in self._model.embed(texts)]

    def embed_query(self, text: str) -> List[float]:
        return self.embed_documents([text])[0]


embeddings = FastEmbedEmbeddings()

VECTOR_SIZE = 384

client = QdrantClient(
    url=QDRANT_URL,
    api_key=QDRANT_API_KEY,
    timeout=10.0,       # fail fast instead of hanging for up to 60s
    prefer_grpc=False,   # persistent binary channel, less per-call overhead than REST/JSON
)

_collection_ready = False  # process-level cache, avoids a network hop on every import


def ensure_collection():
    """
    Create the shared collection once if it doesn't already exist.
    Cached per-process so this never touches the network again after
    the first successful check, even if this module gets re-imported.
    """
    global _collection_ready
    if _collection_ready:
        return

    if not client.collection_exists(COLLECTION_NAME):
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=qmodels.VectorParams(
                size=VECTOR_SIZE,
                distance=qmodels.Distance.COSINE,
            ),
            # Every query in this module filters by video_id and none
            # ever runs an unfiltered search, so drop the global graph
            # (m=0) in favor of per-tenant graphs (payload_m). Raise
            # payload_m if recall on very long/large videos suffers.
            hnsw_config=qmodels.HnswConfigDiff(m=0, payload_m=16),
        )
        # is_tenant tells Qdrant to co-locate each video's points on
        # disk, so a video_id-filtered search reads sequentially
        # instead of scattering lookups across the whole collection.
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="metadata.video_id",
            field_schema=qmodels.KeywordIndexParams(
                type=qmodels.KeywordIndexType.KEYWORD,
                is_tenant=True,
            ),
        )

    _collection_ready = True


ensure_collection()

vectorstore = QdrantVectorStore(
    client=client,
    collection_name=COLLECTION_NAME,
    embedding=embeddings,
)

# Videos already confirmed indexed during this process's lifetime.
# Skips a Qdrant round-trip on every repeat call for the same video.
_indexed_cache = set()


def _video_id_filter(video_id: str) -> qmodels.Filter:
    return qmodels.Filter(
        must=[
            qmodels.FieldCondition(
                key="metadata.video_id",
                match=qmodels.MatchValue(value=video_id),
            )
        ]
    )


def is_video_indexed(video_id: str) -> bool:
    if video_id in _indexed_cache:
        return True

    # scroll(limit=1) stops at the first match instead of counting
    # every matching point the way count(exact=True) does.
    points, _ = client.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=_video_id_filter(video_id),
        limit=1,
        with_payload=False,
        with_vectors=False,
    )
    found = len(points) > 0
    if found:
        _indexed_cache.add(video_id)
    return found


def get_transcript_chunks(video_id, interval=CHUNK_INTERVAL_SECONDS):
    """
    Fetch a YouTube transcript and group snippets into fixed-length
    time windows, suitable for RAG chunking.

    Returns a list of dicts: {start, end, text}
    """
    ytt_api = YouTubeTranscriptApi(
        proxy_config=GenericProxyConfig(
            http_url="http://3b9f5abf68a75717e50c:4c4f618f9e7cabbd@gw.dataimpulse.com:823",
            https_url="https://3b9f5abf68a75717e50c:4c4f618f9e7cabbd@gw.dataimpulse.com:823",
        )
    )
    #curl -x "" 
    try:
        fetched = ytt_api.fetch(video_id)
    except Exception as e:
        raise RuntimeError(f"YouTube transcript fetch failed: {e}") from e

    chunks = []
    current_chunk_text = []
    chunk_start = 0
    chunk_end = interval

    for snippet in fetched:
        # If this snippet starts past the current window, close it out
        while snippet.start >= chunk_end:
            if current_chunk_text:
                chunks.append({
                    "start": chunk_start,
                    "end": chunk_end,
                    "text": " ".join(current_chunk_text).strip()
                })
            current_chunk_text = []
            chunk_start = chunk_end
            chunk_end += interval

        current_chunk_text.append(snippet.text)

    # Add the final chunk
    if current_chunk_text:
        chunks.append({
            "start": chunk_start,
            "end": chunk_end,
            "text": " ".join(current_chunk_text).strip()
        })

    return chunks


def get_or_build_index(video_id, interval=CHUNK_INTERVAL_SECONDS):
    """
    Ensures the video's transcript chunks exist in the shared Qdrant
    collection. If this video is already indexed, this is a cached or
    single-point lookup and no fetching/embedding happens.
    """
    if is_video_indexed(video_id):
        return

    chunks = get_transcript_chunks(video_id, interval=interval)

    docs = [
        Document(
            page_content=c["text"],
            metadata={
                "video_id": video_id,
                "start": c["start"],
                "end": c["end"],
                "url": f"https://www.youtube.com/watch?v={video_id}&t={c['start']}s"
            }
        )
        for c in chunks if c["text"].strip()
    ]

    if not docs:
        return

    # Deterministic IDs (based on video_id + chunk start) so re-running
    # this for the same video is idempotent instead of creating duplicates
    ids = [
        str(uuid.uuid5(uuid.NAMESPACE_URL, f"{video_id}-{c['start']}"))
        for c in chunks if c["text"].strip()
    ]

    vectorstore.add_documents(docs, ids=ids)
    _indexed_cache.add(video_id)


@tool
def transcription(video_id: str, query: str) -> str:
    """Search a YouTube video's transcript in detail for content relevant to a query.

    Args:
        video_id: The YouTube video ID to search within.
        query: What you want to find in the video's transcript.

    Returns:
        Matching transcript chunks, each with its timestamp range and a
        timestamped URL into the video.
    """
    try:
        get_or_build_index(video_id)

        results = vectorstore.similarity_search(
            query,
            k=4,
            filter=_video_id_filter(video_id),
        )

        return "\n".join(
            f"[{d.metadata['start']}s - {d.metadata['end']}s] {d.page_content} ({d.metadata['url']})"
            for d in results
        )
    except Exception as e:
        return f"Error retrieving transcript: {e}"

if __name__ == "__main__":
    print("Set up is complete")

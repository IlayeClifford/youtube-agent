import os
import uuid
#import time
from dotenv import load_dotenv
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import WebshareProxyConfig

from langchain_core.tools import tool
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")
QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")

COLLECTION_NAME = "video_transcripts"
VECTOR_SIZE = 384  # all-MiniLM-L6-v2 output dimension

embedding = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2",
    model_kwargs={
        "device": "cpu",
        "token": HF_TOKEN,
    },
    encode_kwargs={
        "batch_size": 64,
        "normalize_embeddings": True,
    },
)

client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=60.0)


def ensure_collection():
    """Create the shared collection once if it doesn't already exist."""
    existing = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME not in existing:
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=qmodels.VectorParams(
                size=VECTOR_SIZE,
                distance=qmodels.Distance.COSINE,
            ),
        )
        # Index video_id so metadata-filtered lookups/searches are fast
        client.create_payload_index(
            collection_name=COLLECTION_NAME,
            field_name="metadata.video_id",
            field_schema=qmodels.PayloadSchemaType.KEYWORD,
        )


ensure_collection()

vectorstore = QdrantVectorStore(
    client=client,
    collection_name=COLLECTION_NAME,
    embedding=embedding,
)


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
    result = client.count(
        collection_name=COLLECTION_NAME,
        count_filter=_video_id_filter(video_id),
        exact=True,
    )
    return result.count > 0


def get_transcript_chunks(video_id, interval=10):
    """
    Fetch a YouTube transcript and group snippets into fixed-length
    time windows (default 10s), suitable for RAG chunking.

    Returns a list of dicts: {start, end, text}
    """
    ytt_api = YouTubeTranscriptApi(
        proxy_config=WebshareProxyConfig(
            proxy_username=os.getenv("PROXY_NAME"),
            proxy_password=os.getenv("PROXY_PASSWORD"),
        )
    )
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


def get_or_build_index(video_id, interval=30):
    """
    Ensures the video's transcript chunks exist in the shared Qdrant
    collection. If another user already indexed this video, this is a
    fast metadata lookup and no fetching/embedding happens.
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


@tool
def transcription(video_id: str, query: str) -> str:
    """You will use this tool to Search a YouTube video's transcript for content relevant to the query or what you are looking searching.
    Args:
    Video_id: You will include search for the video using the video ID you have recieved.
    query: This is what you want to ask or what you want from the transcription of the video

    Returns:
    Chunk of related events from the transcription of the video along with the url and time stamp
    """
    try:
        get_or_build_index(video_id, interval=30)

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
        return f"Error retrieving trancripts {e}"

# start = time.time()
# print(transcription.invoke({"video_id": "jGg_1h0qzaM", "query": "What is agentic AI"}))
# end_time = time.time()

#print(f"It took {end_time-start}")
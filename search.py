import os
import html
import concurrent.futures
from datetime import datetime
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from langchain_core.tools import tool
from datetime import datetime, timezone, timedelta

yesterday = datetime.now(timezone.utc) - timedelta(days=1)
def _youtube_search(query: str, max_results: int = 5):
    """
    Direct call to the YouTube Data API v3 search endpoint.

    Returns a list of "title: ... link: ..." strings on success, or a
    single-item list carrying an error message on failure — the tool
    always returns a list, so nothing downstream has to branch on type.
    """
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        return ["error: Missing YOUTUBE_API_KEY environment variable."]

    try:
        youtube = build("youtube", "v3", developerKey=api_key)

        request = youtube.search().list(
            q=query,
            part="snippet",
            type="video",
            order="date",  # Ensures the most recent videos are first
            publishedAfter=yesterday.isoformat().replace('+00:00', 'Z'),
            maxResults=max_results,
        )
        response = request.execute()

        results = []
        for item in response.get("items", []):
            raw_title = item["snippet"]["title"]
            clean_title = html.unescape(raw_title)  # e.g. &amp; -> &

            video_id = item["id"]["videoId"]
            link = f"https://www.youtube.com/watch?v={video_id}"

            results.append(f"title: {clean_title} link: {link}")

        if not results:
            return [f"No YouTube results found for '{query}'."]

        return results

    except HttpError as e:
        # Keeps a failed API call from taking down the whole agent run
        return [f"error: YouTube API request failed: {e.reason}"]
    except Exception as e:
        return [f"error: An unexpected error occurred: {str(e)}"]


@tool
def run_with_timeout(query_str: str, timeout_seconds: int = 15):
    """
    Search YouTube for videos matching a natural language query.
    Query: your intended search in natural language

    Returns:
    A list of "title: ... link: ..." strings for matching YouTube videos,
    or an error/timeout message if the search failed.
    """
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_youtube_search, query_str)
        try:
            return future.result(timeout=timeout_seconds)
        except concurrent.futures.TimeoutError:
            return ["Could not retrieve results at this moment, try again later or visit youtube."]


if __name__ == "__main__":
    print("Setup is complete")
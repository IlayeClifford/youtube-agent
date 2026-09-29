from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import os
from langchain.tools import tool
from dotenv import load_dotenv
load_dotenv()

@tool
def meta_data(video_id: str):
    """Use this tool to query the summary about the video from a youtube video using the unique video ID
    Args: 
    video_id: This is the unique ID from the youtube URL.
    Return: 
    Title of the video, Channel name, Description
    """

    try:
        # 1. Set up your API Key (from Google Cloud Console)
        api_key = os.getenv("YOUTUBE_API_KEY")
        youtube = build('youtube', 'v3', developerKey=api_key)

        # 2. Call the API
        request = youtube.videos().list(
            part="snippet,statistics,contentDetails",
            id=video_id
        )
        response = request.execute()

        # 3. Access the metadata
        items = response.get('items') or []
        if not items:
            return (
                f"Couldn't find a video with ID '{video_id}' — it may be "
                "private, deleted, or the ID might be wrong."
            )

        video_data = items[0]
        channel_name = video_data['snippet']['channelTitle']
        video_description = video_data['snippet']['description']
        title = video_data['snippet']['title']

        return f"Title: {title}\n Channel name {channel_name}\n Video content: {video_description}"

    except HttpError as e:
        return f"YouTube API error while looking up '{video_id}': {e.reason}"
    except Exception as e:
        return f"Unexpected error looking up video '{video_id}': {e}"


if __name__ == "__main__":
    print("Set up is complete")

from googleapiclient.discovery import build
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


# 1. Set up your API Key (from Google Cloud Console)
    api_key = os.getenv("YOUTUBE_API_KEY")
    youtube = build('youtube', 'v3', developerKey=api_key)


    video_id = video_id
    # 3. Call the API
    request = youtube.videos().list(
        part="snippet,statistics,contentDetails",
        id=video_id
    )
    response = request.execute()

    # 4. Access the metadata
    video_data = response['items'][0]
    has_captions = video_data['contentDetails']['caption']
    channel_name = video_data['snippet']['channelTitle']
    video_description = video_data['snippet']['description']

    title = video_data['snippet']['title']
    

    return f"Title: {title}\n Channel name {channel_name}\n Video content: {video_description}"

if __name__ == "__main__":
    print("Set up is complete")


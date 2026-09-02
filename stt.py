from io import BytesIO
import wave
import asyncio
import os 
from groq import Groq
from typing import Tuple

groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
class Config:
    """Centralized configuration"""
    
    # Audio settings
    WHISPER_MODEL = "whisper-large-v3"
    MAX_AUDIO_SIZE_MB = 25
    MIN_AUDIO_SIZE_KB = 0.001
    

# Audio parameters for raw PCM conversion
SAMPLE_RATE = 24000 
CHANNELS = 1  # Mono
SAMPLE_WIDTH = 2  # 16-bit audio

import logging
logging.basicConfig(
    level = logging.INFO, 
    format="%(asctime)s [%(levelname)s] %(name)s : %(message)s",
    handlers = [
        logging.StreamHandler(),
        logging.FileHandler("chatbot.log")
        ]
)
logger = logging.getLogger("GroqSTTBot")

def detect_audio_format(audio_data: bytes) -> Tuple[str, str, bool]:
    """
    Detect audio format from magic bytes.
    
    Args:
        audio_data: Raw audio bytes
    
    Returns:
        Tuple of (mime_type, filename, is_raw_pcm)
    """
    if len(audio_data) < 4:
        logger.warning("Audio data too short to detect format")
        return "audio/wav", "audio.wav", True
    
    magic_bytes = audio_data[:4]
    hex_magic = magic_bytes.hex()
    
    # Check for raw PCM (all zeros or no recognizable header)
    if magic_bytes == b'\x00\x00\x00\x00' or hex_magic == "00000000":
        logger.info("Detected raw PCM audio data")
        return "audio/wav", "audio.wav", True
    
    # WebM: 1A 45 DF A3
    if magic_bytes == b'\x1a\x45\xdf\xa3':
        return "audio/webm", "audio.webm", False
    
    # WAV: RIFF
    elif magic_bytes[:4] == b'RIFF':
        return "audio/wav", "audio.wav", False
    
    # MP4/M4A: ftyp (at offset 4)
    elif len(audio_data) > 8 and audio_data[4:8] == b'ftyp':
        return "audio/mp4", "audio.mp4", False
    
    # OGG: OggS
    elif magic_bytes[:4] == b'OggS':
        return "audio/ogg", "audio.ogg", False
    
    # MP3: ID3 or FF FB/FF F3
    elif magic_bytes[:3] == b'ID3' or magic_bytes[:2] in [b'\xff\xfb', b'\xff\xf3']:
        return "audio/mp3", "audio.mp3", False
    
    else:
        logger.warning(f"Unknown audio format (magic bytes: {hex_magic}), treating as raw PCM")
        return "audio/wav", "audio.wav", True
    

def convert_raw_pcm_to_wav(pcm_data: bytes, sample_rate: int = SAMPLE_RATE, 
                           channels: int = CHANNELS, sample_width: int = SAMPLE_WIDTH) -> bytes:
    """
    Convert raw PCM audio data to WAV format.
    
    Args:
        pcm_data: Raw PCM audio bytes
        sample_rate: Sample rate in Hz (default: 48000)
        channels: Number of audio channels (default: 1 for mono)
        sample_width: Bytes per sample (default: 2 for 16-bit)
    
    Returns:
        WAV formatted audio bytes
    """
    logger.info(f"Converting {len(pcm_data)} bytes of raw PCM to WAV "
                f"({sample_rate}Hz, {channels}ch, {sample_width*8}bit)")
    
    wav_buffer = BytesIO()
    
    try:
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(sample_width)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_data)
        
        wav_bytes = wav_buffer.getvalue()
        logger.info(f"WAV conversion successful: {len(wav_bytes)} bytes")
        return wav_bytes
    
    except Exception as e:
        logger.error(f"WAV conversion failed: {e}", exc_info=True)
        raise
async def process_audio(audio_data: bytes) -> tuple[str, bytes, str]:
    """
    Process audio: validate, convert if needed, and transcribe
    
    Returns:
        Tuple of (transcription_text, playback_audio, playback_mime)
    
    Raises:
        ValueError: If audio is invalid
        Exception: If transcription fails
    """
    # Validate audio size
    size_mb = len(audio_data) / (1024 * 1024)
    logger.info(f"Processing audio: {size_mb:.2f} MB")
    
    if size_mb > Config.MAX_AUDIO_SIZE_MB:
        raise ValueError(
            f"Audio file too large ({size_mb:.1f}MB). "
            f"Maximum size is {Config.MAX_AUDIO_SIZE_MB}MB."
        )
    
    if size_mb < Config.MIN_AUDIO_SIZE_KB:
        raise ValueError("Audio too short. Please record a longer message.")
    
    # Detect and convert audio format
    mime_type, filename, is_raw_pcm = detect_audio_format(audio_data)
    logger.info(f"Detected format: {mime_type}, is_raw_pcm={is_raw_pcm}")
    
    if is_raw_pcm:
        logger.info("Converting raw PCM to WAV")
        converted_audio = convert_raw_pcm_to_wav(audio_data)
        playback_audio = converted_audio
        playback_mime = "audio/wav"
        filename = "audio.wav"
    else:
        converted_audio = audio_data
        playback_audio = audio_data
        playback_mime = mime_type
    
    # Transcribe
    import io
    audio_file = io.BytesIO(converted_audio)
    
    logger.info("Starting transcription...")
    transcription = await asyncio.to_thread(
        groq_client.audio.transcriptions.create,
        file=(filename, audio_file),
        model=Config.WHISPER_MODEL,
        response_format="text",
        language="en"
    )
    
    text = transcription if isinstance(transcription, str) else transcription.text
    
    if not text or not text.strip():
        raise ValueError("No speech detected in audio")
    
    logger.info(f"Transcription successful: '{text[:50]}...'")
    return text.strip(), playback_audio, playback_mime


if __name__ == "__main__":
    logger.info("Starting Groq STT Chatbot...")
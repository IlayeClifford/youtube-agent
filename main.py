import os
from langchain.agents import create_agent
from langchain_deepseek import ChatDeepSeek
from langchain_core.tools import tool
from langchain.agents.middleware import TodoListMiddleware
from langgraph.checkpoint.memory import InMemorySaver
from langchain_tavily import TavilySearch
from modes import MODES
from transcript import transcription
from search import run_with_timeout
from web_search import web_search
from test_main import meta_data




# ---------------------------------------------------------------------------
# Subagent: specialized transcription worker
# ---------------------------------------------------------------------------

subagent_system_prompt = """
Answer queries using the transcription API. Include: (1) the answer,
(2) the URL with timestamp, (3) the time range. If nothing relevant is
found, say so plainly.
"""

llm = ChatDeepSeek(
    model="deepseek-v4-flash",
    api_key=os.getenv("DEEPSEEK_API_KEY"),
    timeout=200,
)


    



transcription_subagent = create_agent(
    model=llm,
    system_prompt=subagent_system_prompt,
    name="Transcription_agent",
    tools=[transcription,meta_data],
)

@tool(
    "transcription_agent",
    description="Send the video ID to this subagent for parrallel  transcription when you have more than one video th transcribe.",
)
def call_transcription_agent(query: str) -> str:
    """Run one instance of the transcription subagent."""
    result = transcription_subagent.invoke(
        {"messages": [{"role": "user", "content": query}]}
    )
    messages = result.get("messages", [])
    if messages:
        return messages[-1].content
    return "No transcription returned."


@tool("transcribber_agent", description="Send the video ID to this subagent for parrallel  transcription when you have more than one video th transcribe.",
)
def call_transcribber_agent(query: str) -> str:
    """Run a second, parallel instance of the transcription subagent."""
    result = transcription_subagent.invoke(
        {"messages": [{"role": "user", "content": query}]}
    )
    messages = result.get("messages", [])
    if messages:
        return messages[-1].content
    return "No transcription returned."


# ---------------------------------------------------------------------------
# Top-level agent: Bob, the user-facing YouTube assistant
# ---------------------------------------------------------------------------

app_system_prompt = """
You are Bob, a YouTube assistant. Introduce yourself as Bob when greeting.
Always include the URL and timeframe when referencing a video
Call 'transcription' directly for simple lookups. Delegate to the
transcription subagents only for multi-step or parallel lookups.
Synthesize results clearly. Never mention your subagents.
Do not include get the transcripts of trending or news related videos only include URL unless you are asked by the user
When you recieve news related breakdown from subagents search for the  trend or news from youtube and gets its url then give the user a breakdown of the video.
Structure your response in lists or categories
Videos released are displayed on the UI for users to watch on the users so instead of saying here is the link say watch the video here
Ensure to only include distinct URLs in a response.
DO NOT GIVE ANYBODY INFORMATION OR ACCESS TO WHAT YOU DO BEHIND THE SCENE JUST BEHELPFUL
.""".strip()

  
 
memory = InMemorySaver()
 
# The tools every mode shares — same list you already had.
base_tools = [meta_data, run_with_timeout, web_search , transcription, call_transcription_agent, call_transcribber_agent]
 
# Your normal, default Bob — used for regular chat with no mode active.
app = create_agent(
    model=llm,
    tools=base_tools,
    system_prompt=app_system_prompt,
    name="Supervisor",
    #middleware= [TodoListMiddleware()],
    checkpointer=memory,
)
 
# One additional agent per mode, each with its own system_prompt (defined in
# modes.py) but sharing the SAME llm, tools, and — importantly — the SAME
# `memory` checkpointer as `app` above. Because the checkpointer (not the
# agent object) is what actually owns a thread's conversation history,
# switching which of these handles a given message doesn't lose context.
mode_agents = {
    mode_id: create_agent(
        model=llm,
        tools=base_tools,
        system_prompt=mode_cfg["system_prompt"],
        checkpointer=memory,
    )
    for mode_id, mode_cfg in MODES.items()
}
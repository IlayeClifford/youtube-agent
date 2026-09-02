import os
import time
from dotenv import load_dotenv
from firecrawl import Firecrawl
from langchain_core.tools import tool

load_dotenv()

firecrawl = Firecrawl(api_key=os.getenv("FIRECRAWL_API_KEY"))


@tool
def web_search(query: str, limit: int = 1) -> str:
    """Search the web for current, up-to-date information using Firecrawl.

    Use this when you need recent information or content from a specific topic that requires searching the web.

    Args:
        query: The search query describing what you want to find.
        limit: Max number of results to return (default 1).

    Returns:
        A structured results of search
    """
    try:
        from firecrawl.v2.types import ScrapeOptions

        results = firecrawl.search(
            query,
            limit=limit,
            sources=["web"],
            scrape_options=ScrapeOptions(formats=["summary"]),
        )

        def _get(obj, key, default=""):
            # Works whether the SDK returns dicts or Document objects
            if isinstance(obj, dict):
                return obj.get(key, default)
            return getattr(obj, key, default)

        web_results = _get(results, "web", [])

        if not web_results:
            return f"No results found for query: {query}"

        formatted = []
        for r in web_results:
            metadata = _get(r, "metadata", None)

            title = _get(r, "title", None) or _get(metadata, "title", "Untitled")
            url = _get(r, "url", None) or _get(metadata, "source_url", None) or _get(metadata, "url", "")
            summary = _get(r, "summary", "") or "(no summary available)"
            formatted.append(f"Title: {title}\nURL: {url}\nSummary: {summary}")

        return "\n\n".join(formatted)

    except Exception as e:
        return f"Error performing web search: {e}"

if "__main__" == __name__:
    print("Search is done")


# print(firecrawl_web_search.invoke({"query": "latest langgraph release notes", "limit": 3}))
# start = time.time()
# print(firecrawl_web_search.invoke({"query": "Why is very dark man trending?", "limit": 1}))
# print(f"It took {time.time()-start}")
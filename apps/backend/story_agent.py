from __future__ import annotations

import asyncio
import os

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ai_definitions import StoryPage, StoryPageEvent, StoryCompleteEvent


class StoryGenerationResult(BaseModel):
    pages: list[StoryPage]


_SYSTEM_PROMPT = """\
You are a master children's bedtime storyteller. Given a story concept, write a \
complete 5-page bedtime story. Each page should have 2-3 sentences of warm, \
age-appropriate prose, and a one-sentence image_prompt describing a vivid, \
child-friendly illustration for that page.

The story should have a clear arc: setup → adventure → challenge → resolution → warm ending.
End with the protagonist feeling safe, loved, and ready to sleep.\
"""


def _build_story_prompt(seed: dict, child_name: str, child_age: int) -> str:
    return (
        f"Story title: {seed['title']}\n"
        f"Setting: {seed['setting']}\n"
        f"Values to weave in: {', '.join(seed['values'])}\n"
        f"Synopsis: {seed['synopsis']}\n"
        f"For: {child_name}, age {child_age}\n\n"
        "Write the complete 5-page story."
    )


_agent: Agent[None, StoryGenerationResult] | None = None


def get_story_agent() -> Agent[None, StoryGenerationResult]:
    global _agent
    if _agent is None:
        key = os.getenv("MODEL_ACCESS_KEY")
        if not key:
            raise RuntimeError("MODEL_ACCESS_KEY environment variable is not set")
        model = OpenAIChatModel(
            os.getenv("MODEL_NAME", "llama3.3-70b-instruct"),
            provider=OpenAIProvider(
                base_url="https://inference.do-ai.run/v1/",
                api_key=key,
            ),
        )
        _agent = Agent(model, output_type=StoryGenerationResult, system_prompt=_SYSTEM_PROMPT)
    return _agent


async def run_story_agent(
    seed: dict,
    child_name: str,
    child_age: int,
    queue: asyncio.Queue,
) -> None:
    """Background task: generates story pages and streams them onto the queue."""
    try:
        result = await get_story_agent().run(
            _build_story_prompt(seed, child_name, child_age)
        )
        pages: list[StoryPage] = result.output.pages
        for page in pages:
            event = StoryPageEvent(page_number=page.page_number, text=page.text)
            await queue.put(event.model_dump())
            await asyncio.sleep(0.05)  # yield so SSE flushes between pages
        await queue.put(StoryCompleteEvent(total_pages=len(pages)).model_dump())
    except Exception as exc:
        await queue.put({
            "event": "error",
            "stage": "storyteller",
            "message": str(exc),
        })

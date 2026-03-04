from __future__ import annotations

import asyncio
import os

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ai_definitions import ParentPrompt, SeedOption, SeedOptionsEvent


class SeedGenerationResult(BaseModel):
    seeds: list[SeedOption]


_SYSTEM_PROMPT = """\
You are a creative children's story architect. Generate exactly 3 distinct seed story \
options for a personalised bedtime story tailored to a specific child.

Each seed must:
- Be age-appropriate for the child's age
- Directly address the emotional situation described by the parent
- Weave in at least one of the requested values organically
- Have a unique, imaginative setting (no two seeds may share a setting)
- Have a warm, hopeful 2-3 sentence synopsis written to excite the parent\
"""


def _build_prompt(p: ParentPrompt) -> str:
    values_str = ", ".join(p.values) if p.values else "kindness"
    return (
        f"Child: {p.child_name}, age {p.child_age}\n"
        f"What happened today: {p.description}\n"
        f"Values to explore: {values_str}\n\n"
        "Generate 3 seed story options."
    )


_agent: Agent[None, SeedGenerationResult] | None = None


def get_seed_agent() -> Agent[None, SeedGenerationResult]:
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
        _agent = Agent(model, output_type=SeedGenerationResult, system_prompt=_SYSTEM_PROMPT)
    return _agent


async def run_seed_agent(
    story_id: str,
    prompt: ParentPrompt,
    queue: asyncio.Queue,
    state_store: dict,
) -> None:
    """Background task: calls the seed agent and pushes a seed_options event onto the queue."""
    try:
        print(f"[seed_agent] Starting for story {story_id}")
        result = await get_seed_agent().run(_build_prompt(prompt))
        seeds: list[SeedOption] = result.output.seeds
        print(f"[seed_agent] Got {len(seeds)} seeds for story {story_id}")
        state_store["seeds"] = [s.model_dump() for s in seeds]
        event = SeedOptionsEvent(seeds=seeds)
        await queue.put(event.model_dump())
    except Exception as exc:
        print(f"[seed_agent] ERROR for story {story_id}: {exc}")
        await queue.put({
            "event": "error",
            "stage": "seed_generation",
            "message": str(exc),
        })

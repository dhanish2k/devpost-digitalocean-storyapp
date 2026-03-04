from __future__ import annotations

import asyncio
import json
import os
import re

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

from ai_definitions import ParentPrompt, SeedOption, SeedOptionsEvent


_SYSTEM_PROMPT = """\
You are a creative children's story architect. Generate exactly 3 distinct seed story \
options for a personalised bedtime story tailored to a specific child.

Each seed must:
- Be age-appropriate for the child's age
- Directly address the emotional situation described by the parent
- Weave in at least one of the requested values organically
- Have a unique, imaginative setting (no two seeds may share a setting)
- Have a warm, hopeful 2-3 sentence synopsis written to excite the parent

Respond with ONLY a valid JSON array of exactly 3 objects. No prose, no markdown, no code fences.
Each object must have these fields:
  "seed_id": a short unique slug (e.g. "forest-courage-1")
  "title": a captivating story title
  "setting": a one-phrase description of the world (e.g. "an enchanted underwater library")
  "values": an array of strings from the parent's requested values this story explores
  "synopsis": 2-3 sentences describing the story arc, written for the parent

Example format:
[
  {
    "seed_id": "forest-courage-1",
    "title": "The Brave Little Lantern",
    "setting": "an enchanted forest where fireflies keep secrets",
    "values": ["courage", "empathy"],
    "synopsis": "A shy lantern discovers that lighting the way for others is the greatest act of courage. When her best friend goes missing, she must venture into the darkest part of the forest alone."
  }
]
"""


def _build_prompt(p: ParentPrompt) -> str:
    values_str = ", ".join(p.values) if p.values else "kindness"
    return (
        f"Child: {p.child_name}, age {p.child_age}\n"
        f"What happened today: {p.description}\n"
        f"Values to explore: {values_str}\n\n"
        "Generate 3 seed story options as a JSON array."
    )


def _parse_seeds(raw: str) -> list[SeedOption]:
    """Extract and validate seed JSON from the model's response text."""
    # Strip markdown code fences if the model added them anyway
    text = re.sub(r"```(?:json)?\s*", "", raw).strip()
    # Find the JSON array
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON array found in model response: {raw!r}")
    data = json.loads(match.group())
    return [SeedOption(**item) for item in data]


_agent: Agent[None, str] | None = None


def get_seed_agent() -> Agent[None, str]:
    global _agent
    if _agent is None:
        key = os.getenv("MODEL_ACCESS_KEY")
        if not key:
            raise RuntimeError("MODEL_ACCESS_KEY environment variable is not set")
        model = OpenAIChatModel(
            os.getenv("MODEL_NAME", "llama3-8b-instruct"),
            provider=OpenAIProvider(
                base_url="https://inference.do-ai.run/v1/",
                api_key=key,
            ),
        )
        _agent = Agent(model, system_prompt=_SYSTEM_PROMPT)
    return _agent


async def run_seed_agent(
    story_id: str,
    prompt: ParentPrompt,
    queue: asyncio.Queue,
) -> None:
    """Background task: calls the seed agent and pushes a seed_options event onto the queue."""
    try:
        result = await get_seed_agent().run(_build_prompt(prompt))
        seeds = _parse_seeds(result.output)
        event = SeedOptionsEvent(seeds=seeds)
        await queue.put(event.model_dump())
    except Exception as exc:
        await queue.put({
            "event": "error",
            "stage": "seed_generation",
            "message": str(exc),
        })

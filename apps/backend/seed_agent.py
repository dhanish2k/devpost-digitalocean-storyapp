from __future__ import annotations

import asyncio
import os

import uuid
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

from ai_definitions import ParentPrompt, SeedOption, SeedOptionsEvent, SeedImageReadyEvent
from fal_client import generate_image


class _SeedDraft(BaseModel):
    """What the LLM actually needs to produce — seed_id is generated server-side."""
    title:    str         = Field(description="Story title")
    setting:  str         = Field(description="One-phrase world description, e.g. 'enchanted forest' or 'underwater kingdom'")
    values:   list[str]   = Field(description="2-4 emotional themes that emerge through the story action")
    synopsis: str         = Field(description="2-3 sentence teaser for the parent, no moral named")


class SeedGenerationResult(BaseModel):
    seeds: list[_SeedDraft]


_SYSTEM_PROMPT = """\
You are a creative children's story architect. Generate exactly 3 distinct seed story options \
for a personalised bedtime story tailored to a specific child.

Each seed must:
- Match the child's age precisely — the stakes, language, and sense of wonder must feel right for that age
- Address the emotional situation the parent described through the STORY SITUATION, not by naming feelings or lessons
- Propose a concrete, active conflict: a lost creature, a task that seems impossible, a mystery to solve, \
  a friend in trouble — NOT merely "someone was unkind" or "they had a hard day"
- Have a wholly unique setting (no two seeds may share a world, genre, or tone)
- Write a warm, imaginative 2-3 sentence synopsis that excites the parent without naming the moral\
"""


def _build_prompt(p: ParentPrompt) -> str:
    gender_hint    = f" ({p.child_gender})" if p.child_gender else ""
    archetype_hint = (
        f"\nProtagonist: {p.child_name} is a {p.child_archetype}{gender_hint}"
        if p.child_archetype
        else (f"\nProtagonist gender: {p.child_gender}" if p.child_gender else "")
    )
    values_line = (
        f"\nEmotional themes to draw on (let these emerge through the story — do NOT name them): {', '.join(p.values)}"
        if p.values else
        "\nInfer the most resonant emotional themes from what happened — do NOT name them in the story."
    )
    return (
        f"Child: {p.child_name}, age {p.child_age}\n"
        f"What happened today: {p.description}"
        f"{values_line}"
        f"{archetype_hint}\n\n"
        f"Generate exactly 3 seed story options. "
        f"Each seed MUST include: title, setting (one-phrase world), values (2-4 themes), synopsis (2-3 sentences)."
        + ("\n\nIMPORTANT: Write ALL output (titles, settings, synopses) in Spanish." if p.language == "es" else "")
    )


_agent: Agent[None, SeedGenerationResult] | None = None


def get_seed_agent() -> Agent[None, SeedGenerationResult]:
    global _agent
    if _agent is None:
        key = os.getenv("MODEL_ACCESS_KEY")
        if not key:
            raise RuntimeError("MODEL_ACCESS_KEY environment variable is not set")
        model = OpenAIChatModel(
            os.getenv("SEED_MODEL_NAME") or os.getenv("MODEL_NAME", "llama3.3-70b-instruct"),
            provider=OpenAIProvider(
                base_url="https://inference.do-ai.run/v1/",
                api_key=key,
            ),
        )
        _agent = Agent(model, name="seed-agent", output_type=SeedGenerationResult, system_prompt=_SYSTEM_PROMPT,
                       model_settings=ModelSettings(timeout=60.0))
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
        seeds: list[SeedOption] = [
            SeedOption(seed_id=str(uuid.uuid4()), **draft.model_dump())
            for draft in result.output.seeds
        ]
        print(f"[seed_agent] Got {len(seeds)} seeds for story {story_id}")
        state_store["seeds"] = [s.model_dump() for s in seeds]
        event = SeedOptionsEvent(seeds=seeds)
        await queue.put(event.model_dump())
        for seed in seeds:
            asyncio.create_task(_generate_seed_image(seed, queue))
    except Exception as exc:
        print(f"[seed_agent] ERROR for story {story_id}: {exc}")
        await queue.put({
            "event": "error",
            "stage": "seed_generation",
            "message": str(exc),
        })


async def _generate_seed_image(seed: SeedOption, queue: asyncio.Queue) -> None:
    try:
        prompt = (
            f"Children's book illustration, soft watercolor style, warm colors. "
            f"An atmospheric establishing scene of {seed.setting}. "
            f"No characters, no people, no text. Cozy bedtime story art."
        )
        url = await generate_image(prompt)
        await queue.put(SeedImageReadyEvent(seed_id=seed.seed_id, image_url=url).model_dump())
    except Exception as exc:
        print(f"[seed_agent] Image gen failed for seed {seed.seed_id}: {exc}")

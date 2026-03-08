from __future__ import annotations

import asyncio
import os

from pydantic import BaseModel
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

from ai_definitions import StoryPage, StoryPageEvent, StoryCompleteEvent, ImageReadyEvent, NarrationReadyEvent
from fal_client import generate_image, generate_tts
from image_prompt_agent import enhance_image_prompt


class CharacterDefinition(BaseModel):
    name: str
    visual_description: str  # e.g. "7-year-old girl, long red pigtails, freckles, yellow raincoat, small green backpack"


class StoryGenerationResult(BaseModel):
    characters: list[CharacterDefinition]
    pages: list[StoryPage]


_SYSTEM_PROMPT = """\
You are a master children's bedtime storyteller. When given a story brief, you IMMEDIATELY \
produce the complete story — no questions, no clarifications, no preamble. \
Write stories that are vivid, emotionally true, and always show — never tell.

GOLDEN RULES:
1. NEVER name a value, lesson, or moral in the text. No "forgiveness", "kindness", "courage", \
   "friendship", etc. The meaning must emerge entirely from what characters DO and what happens.
2. Every page is ONE specific, grounded scene. Anchor it in concrete sensory detail: \
   what the protagonist sees, hears, touches, or feels in this exact moment.
3. Vary sentence length and rhythm. Short punchy lines alongside richer descriptions.
4. The CHALLENGE must be a real, external obstacle the protagonist actively works to solve — \
   not an emotion to process or a lesson to learn.
5. The RESOLUTION comes from a specific, brave, or clever action the protagonist takes. \
   The reader feels the meaning without being told it.
6. The final page is peaceful and warm. The protagonist is safe, loved, and drifting to sleep.
7. NEVER skip the climactic moment. The page where the protagonist faces the obstacle MUST show \
   the exact action they take to overcome it — one concrete, specific thing they do, say, or use. \
   Never jump from "facing the threat" to "it was resolved". The action must be on the page.
8. NEVER name what a character feels. No "felt proud", "felt happy", "felt scared", "felt relieved". \
   Instead write what their body does or what they notice: shoulders drop, breath comes slow, \
   hands stop shaking, the tight knot in the chest loosens. The reader infers the feeling.

FORMAT:
Step 1 — Characters: Define ALL named characters with precise visual descriptions for the illustrator. \
Include hair (colour and style), eye colour, skin tone, clothing, and one memorable distinctive detail. \
These exact descriptions will be referenced in every image prompt.

Step 2 — Pages: Write the requested number of pages. \
Each page = 2-3 sentences of prose + one image_prompt sentence. \
The image_prompt describes the scene visually — reference characters by name only (never re-describe \
appearance), and capture the mood and action of the scene in one vivid sentence.\
"""

_PAGE_COUNTS = {"short": 3, "medium": 5, "long": 8}


def _build_story_prompt(
    seed: dict,
    child_name: str,
    child_age: int,
    child_gender: str | None = None,
    story_length: str = "medium",
    child_archetype: str | None = None,
    language: str = "en",
) -> str:
    pages = _PAGE_COUNTS.get(story_length, 5)
    gender_hint = f" ({child_gender})" if child_gender else ""
    if child_archetype:
        protagonist_hint = f"\nProtagonist: {child_name} is a {child_archetype}{gender_hint}"
    elif child_gender:
        protagonist_hint = f"\nProtagonist gender: {child_gender}"
    else:
        protagonist_hint = ""
    lang_hint = "\n\nIMPORTANT: Write ALL story text (every page) in Spanish." if language == "es" else ""
    return (
        f"Story title: {seed['title']}\n"
        f"Setting: {seed['setting']}\n"
        f"Emotional themes (emerge through action — do NOT use these words in the text): {', '.join(seed['values'])}\n"
        f"Synopsis: {seed['synopsis']}\n"
        f"For: {child_name}, age {child_age}{protagonist_hint}\n\n"
        f"Write a complete {pages}-page story now. Do not ask questions — generate immediately. "
        f"Make the challenge specific and the resolution earned.{lang_hint}"
    )


_agent: Agent[None, StoryGenerationResult] | None = None


def get_story_agent() -> Agent[None, StoryGenerationResult]:
    global _agent
    if _agent is None:
        key = os.getenv("MODEL_ACCESS_KEY")
        if not key:
            raise RuntimeError("MODEL_ACCESS_KEY environment variable is not set")
        # STORY_MODEL_NAME allows using a stronger model for story generation
        # independently of the seed agent. Check DO's model catalog for options.
        model_name = os.getenv("STORY_MODEL_NAME") or os.getenv("MODEL_NAME", "openai-gpt-oss-120b")
        model = OpenAIChatModel(
            model_name,
            provider=OpenAIProvider(
                base_url="https://inference.do-ai.run/v1/",
                api_key=key,
            ),
        )
        _agent = Agent(model, name="story-agent", output_type=StoryGenerationResult, system_prompt=_SYSTEM_PROMPT,
                       model_settings=ModelSettings(timeout=120.0))
    return _agent


async def run_story_agent(
    seed: dict,
    child_name: str,
    child_age: int,
    queue: asyncio.Queue,
    child_gender: str | None = None,
    narration_enabled: bool = True,
    story_length: str = "medium",
    child_archetype: str | None = None,
    language: str = "en",
) -> None:
    """Background task: generates story pages and streams them onto the queue."""
    try:
        result = await get_story_agent().run(
            _build_story_prompt(seed, child_name, child_age, child_gender, story_length, child_archetype, language)
        )
        pages: list[StoryPage] = result.output.pages
        characters: list[CharacterDefinition] = result.output.characters

        char_desc = ". ".join(
            f"{c.name}: {c.visual_description}" for c in characters
        )
        setting = seed['setting']
        media_tasks = []
        for i, page in enumerate(pages):
            event = StoryPageEvent(page_number=page.page_number, text=page.text)
            await queue.put(event.model_dump())
            # Stagger media tasks by 2s each to avoid concurrent TTS/LLM 500s
            task = asyncio.create_task(
                _generate_page_media(page, queue, char_desc, setting, narration_enabled=narration_enabled, delay=i * 2, language=language)
            )
            media_tasks.append(task)
            await asyncio.sleep(0.05)  # yield so SSE flushes between pages
        await queue.put(StoryCompleteEvent(total_pages=len(pages)).model_dump())
        # Wait for all image/TTS tasks, then signal the SSE stream to close
        await asyncio.gather(*media_tasks, return_exceptions=True)
        await queue.put({"event": "stream_done"})
    except Exception as exc:
        await queue.put({
            "event": "error",
            "stage": "storyteller",
            "message": str(exc),
        })


async def _generate_page_media(
    page: StoryPage,
    queue: asyncio.Queue,
    char_desc: str,
    setting: str,
    narration_enabled: bool = True,
    delay: float = 0,
    language: str = "en",
) -> None:
    if delay:
        await asyncio.sleep(delay)

    # Run prompt enhancement and (optionally) TTS in parallel — they're independent
    if narration_enabled:
        enhanced_prompt, audio_url = await asyncio.gather(
            enhance_image_prompt(page.image_prompt, char_desc, setting),
            generate_tts(page.text, language=language),
            return_exceptions=True,
        )
    else:
        enhanced_prompt = await enhance_image_prompt(page.image_prompt, char_desc, setting)
        audio_url = None

    # Image gen uses the enhanced prompt (fallback to raw if enhancement failed)
    if isinstance(enhanced_prompt, Exception):
        print(f"[story_agent] Prompt enhancement failed for page {page.page_number}: {enhanced_prompt}")
        image_prompt = (
            f"Children's book illustration, soft watercolor, warm colors. "
            f"Characters: {char_desc}. Scene: {page.image_prompt}. No text."
        )
    else:
        image_prompt = enhanced_prompt

    image_url = await generate_image(image_prompt)

    await queue.put(ImageReadyEvent(page_number=page.page_number, image_url=image_url).model_dump())

    if audio_url is not None:
        if isinstance(audio_url, Exception):
            print(f"[story_agent] TTS failed for page {page.page_number}: {audio_url}")
        else:
            await queue.put(NarrationReadyEvent(
                page_number=page.page_number,
                audio_url=audio_url,
                word_timings=[],
            ).model_dump())

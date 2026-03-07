from __future__ import annotations

from typing import Literal
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Domain models (passed between agents)
# ---------------------------------------------------------------------------

class ParentPrompt(BaseModel):
    child_name: str
    child_age: int
    description: str        # e.g. "had a tough day, argued with best friend"
    values: list[str]       # e.g. ["empathy", "forgiveness", "courage"]
    child_gender: str | None = None       # "boy", "girl", or "neutral"
    child_archetype: str | None = None    # e.g. "brave knight", "magical fairy"
    story_length: str = "medium"          # "short" (3p), "medium" (5p), "long" (8p)
    narration_enabled: bool = True
    language: str = "en"                  # "en" or "es"


class SeedOption(BaseModel):
    seed_id: str
    title: str
    setting: str            # e.g. "enchanted forest", "underwater kingdom"
    values: list[str]       # values this story will explore
    synopsis: str           # 2-3 sentence teaser shown to the parent


class StoryPage(BaseModel):
    page_number: int
    text: str
    image_prompt: str       # one-sentence visual description for the artist agent


class WordTiming(BaseModel):
    word: str
    start_ms: int
    end_ms: int


# ---------------------------------------------------------------------------
# SSE events (emitted by the backend, consumed by the frontend)
# ---------------------------------------------------------------------------

class SeedOptionsEvent(BaseModel):
    event: Literal["seed_options"] = "seed_options"
    seeds: list[SeedOption]


class StoryPageEvent(BaseModel):
    event: Literal["story_page"] = "story_page"
    page_number: int
    text: str


class SeedImageReadyEvent(BaseModel):
    event: Literal["seed_image_ready"] = "seed_image_ready"
    seed_id: str
    image_url: str


class ImageReadyEvent(BaseModel):
    event: Literal["image_ready"] = "image_ready"
    page_number: int
    image_url: str


class NarrationReadyEvent(BaseModel):
    event: Literal["narration_ready"] = "narration_ready"
    page_number: int
    audio_url: str
    word_timings: list[WordTiming]


class ErrorEvent(BaseModel):
    event: Literal["error"] = "error"
    stage: str              # e.g. "seed_generation", "storyteller", "artist"
    message: str


class StoryCompleteEvent(BaseModel):
    event: Literal["story_complete"] = "story_complete"
    total_pages: int


# Union type for discriminated parsing
StoryEvent = (
    SeedOptionsEvent
    | SeedImageReadyEvent
    | StoryPageEvent
    | ImageReadyEvent
    | NarrationReadyEvent
    | ErrorEvent
    | StoryCompleteEvent
)

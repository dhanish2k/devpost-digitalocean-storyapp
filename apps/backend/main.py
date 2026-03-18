from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env")

import os
import logfire

logfire.configure(
    send_to_logfire="if-token-present",
    service_name="storytime-backend",
    environment=os.getenv("ENVIRONMENT", "development"),
)
logfire.instrument_pydantic_ai()
logfire.instrument_httpx()
from fastapi import FastAPI, APIRouter, Request
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
import asyncio
import json
import uuid
import random
from pydantic import BaseModel
from typing import Dict

from ai_definitions import ParentPrompt
from seed_agent import run_seed_agent
from story_agent import run_story_agent

app = FastAPI()
logfire.instrument_fastapi(app)
router = APIRouter()

# ALLOWED_ORIGIN can be a comma-separated list for multiple origins.
# Defaults to localhost for local dev.
_raw = os.getenv("ALLOWED_ORIGIN", "http://localhost:3000")
allowed_origins = [o.strip() for o in _raw.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class StoryStream(asyncio.Queue):
    """asyncio.Queue subclass that also keeps an event log for replay.

    Agents call ``await stream.put(item)`` exactly as before.  When the SSE
    generator connects (or *reconnects* after a proxy timeout), it first
    replays every event that was already logged, then tails the queue for new
    ones.  This survives DO App Platform's proxy resets and EventSource
    auto-reconnects without losing events.
    """

    def __init__(self) -> None:
        super().__init__()
        self.log: list[dict] = []

    async def put(self, item: dict) -> None:  # type: ignore[override]
        self.log.append(item)
        await super().put(item)


# In-memory storage for active story streams.
# For production, replace with Redis Pub/Sub.
STREAM_STATE: Dict[str, StoryStream] = {}

# Per-story context: prompt + parsed seeds (needed at /select time).
STORY_STATE: Dict[str, dict] = {}


# ---------------------------------------------------------------------------
# Demo simulation (used by /story.demo page only)
# ---------------------------------------------------------------------------

STORY_PARTS = [
    "Once upon a time, in a kingdom surrounded by misty mountains, there lived a young inventor named Elara.",
    "Elara had built a mechanical bird that could sing melodies no human had ever heard.",
    "One stormy night, the bird suddenly spoke: 'Elara, the mountains are waking up.'",
    "She looked outside and saw the peaks glowing with an ancient, amber light.",
    "Without hesitation, she grabbed her toolkit and set off toward the nearest summit.",
    "Along the way, she met a wandering cartographer who had been mapping paths that didn't exist yesterday.",
    "'The mountains are reshaping themselves,' he warned. 'Something underground is stirring.'",
    "Together, they followed a freshly carved trail into a cavern of crystallised sound.",
    "Every step they took echoed back as music — the walls were alive with frozen harmonies.",
    "At the heart of the cavern, they found it: an enormous, slumbering automaton, older than the kingdom itself.",
]


async def simulate_story(story_id: str, queue: asyncio.Queue):
    """Pushes demo story parts automatically. Only used by the /story/demo path."""
    for part in STORY_PARTS:
        await asyncio.sleep(random.uniform(1.5, 3.0))
        if story_id not in STREAM_STATE:
            break
        await queue.put({"type": "text", "content": part})


# ---------------------------------------------------------------------------
# Routes — note: /story/demo must be declared before /story/{story_id}/...
# ---------------------------------------------------------------------------

@app.get("/")
def read_root():
    return {"Hello": "World"}


@router.post("/story/demo")
async def create_demo_story():
    """Creates a demo story session (no parent prompt required). Used by /story.demo."""
    story_id = str(uuid.uuid4())
    # Queue is created by /stream when the client connects (simulate_story path)
    return {"story_id": story_id}


@router.post("/story")
async def create_story(prompt: ParentPrompt):
    """Creates a real story session. Kicks off the seed agent in the background."""
    story_id = str(uuid.uuid4())
    stream = StoryStream()
    STREAM_STATE[story_id] = stream
    state: dict = {"prompt": prompt, "seeds": []}
    STORY_STATE[story_id] = state
    asyncio.create_task(run_seed_agent(story_id, prompt, stream, state))
    return {"story_id": story_id}


class SeedSelection(BaseModel):
    seed_id: str


@router.post("/story/{story_id}/select")
async def select_seed(story_id: str, selection: SeedSelection):
    """Parent selects a seed story. Fires the storyteller agent to generate pages."""
    state = STORY_STATE.get(story_id)
    queue = STREAM_STATE.get(story_id)
    if not state or not queue:
        return {"status": "error", "message": "Unknown story_id"}
    seed = next(
        (s for s in state.get("seeds", []) if s["seed_id"] == selection.seed_id),
        None,
    )
    if not seed:
        return {"status": "error", "message": f"Seed {selection.seed_id!r} not found"}
    prompt: ParentPrompt = state["prompt"]
    asyncio.create_task(run_story_agent(
        seed, prompt.child_name, prompt.child_age, queue,
        prompt.child_gender, prompt.narration_enabled, prompt.story_length, prompt.child_archetype,
        prompt.language,
    ))
    return {"status": "ok", "seed_id": selection.seed_id, "story_id": story_id}


class StoryPart(BaseModel):
    content: str


@router.post("/story/{story_id}/trigger")
async def trigger_event(story_id: str, part: StoryPart):
    """Demo-only: manually push a story part onto the queue."""
    if story_id in STREAM_STATE:
        await STREAM_STATE[story_id].put({"type": "text", "content": part.content})
        return {"status": "success"}
    return {"status": "error", "message": f"No active stream for story {story_id}"}


@router.get("/stream/{story_id}")
async def message_stream(story_id: str):
    """SSE endpoint. Reads from the story's queue and streams typed events to the client."""
    if story_id not in STREAM_STATE:
        # Demo path: no stream was pre-created, start simulation
        stream = StoryStream()
        STREAM_STATE[story_id] = stream
        asyncio.create_task(simulate_story(story_id, stream))
    else:
        stream = STREAM_STATE[story_id]

    async def event_generator():
        yield {
            "event": "stream_open",
            "data": json.dumps({"message": f"Streaming ready for story {story_id}"}),
        }

        # Replay any events that arrived before this connection (or were consumed
        # by a previous connection that dropped due to a proxy reset).
        # No await between snapshot and drain — safe under cooperative multitasking.
        replay_count = len(stream.log)
        for event in stream.log[:replay_count]:
            event_type = event.get("event", "story_update")
            yield {"event": event_type, "data": json.dumps(event)}
            if event_type in ("stream_done", "error"):
                return
        # Drain those same items from the queue so we don't deliver them twice.
        for _ in range(replay_count):
            if not stream.empty():
                stream.get_nowait()

        while True:
            try:
                data = await asyncio.wait_for(stream.get(), timeout=25.0)
            except asyncio.TimeoutError:
                yield {"comment": "keepalive"}
                continue
            event_type = data.get("event", "story_update")
            yield {"event": event_type, "data": json.dumps(data)}
            if event_type in ("stream_done", "error"):
                break

    return EventSourceResponse(event_generator())

app.include_router(router)

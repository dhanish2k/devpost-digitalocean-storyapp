from fastapi import FastAPI, Request
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

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for active story streams.
# For production, replace with Redis Pub/Sub.
STREAM_STATE: Dict[str, asyncio.Queue] = {}


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


@app.post("/story/demo")
async def create_demo_story():
    """Creates a demo story session (no parent prompt required). Used by /story.demo."""
    story_id = str(uuid.uuid4())
    # Queue is created by /stream when the client connects (simulate_story path)
    return {"story_id": story_id}


@app.post("/story")
async def create_story(prompt: ParentPrompt):
    """Creates a real story session. Kicks off the seed agent in the background."""
    story_id = str(uuid.uuid4())
    queue = asyncio.Queue()
    STREAM_STATE[story_id] = queue
    asyncio.create_task(run_seed_agent(story_id, prompt, queue))
    return {"story_id": story_id}


class SeedSelection(BaseModel):
    seed_id: str


@app.post("/story/{story_id}/select")
async def select_seed(story_id: str, selection: SeedSelection):
    """Parent selects a seed story. Full story generation will be wired here next."""
    if story_id in STREAM_STATE:
        await STREAM_STATE[story_id].put({
            "event": "story_page",
            "page_number": 1,
            "text": f"Your story is being crafted... (seed: {selection.seed_id})",
        })
    return {"status": "ok", "seed_id": selection.seed_id, "story_id": story_id}


class StoryPart(BaseModel):
    content: str


@app.post("/story/{story_id}/trigger")
async def trigger_event(story_id: str, part: StoryPart):
    """Demo-only: manually push a story part onto the queue."""
    if story_id in STREAM_STATE:
        await STREAM_STATE[story_id].put({"type": "text", "content": part.content})
        return {"status": "success"}
    return {"status": "error", "message": f"No active stream for story {story_id}"}


@app.get("/stream/{story_id}")
async def message_stream(request: Request, story_id: str):
    """SSE endpoint. Reads from the story's queue and streams typed events to the client."""
    if story_id not in STREAM_STATE:
        # Demo path: no queue was pre-created, start simulation
        queue = asyncio.Queue()
        STREAM_STATE[story_id] = queue
        asyncio.create_task(simulate_story(story_id, queue))
    else:
        queue = STREAM_STATE[story_id]

    async def event_generator():
        try:
            yield {
                "event": "stream_open",
                "data": json.dumps({"message": f"Streaming ready for story {story_id}"}),
            }
            while True:
                if await request.is_disconnected():
                    print(f"Client for story {story_id} disconnected.")
                    break
                data = await queue.get()
                # Use the event field from the payload to drive the SSE event name.
                # Falls back to "story_update" for demo simulation payloads.
                event_type = data.get("event", "story_update")
                yield {"event": event_type, "data": json.dumps(data)}
        except asyncio.CancelledError:
            print(f"Connection cancelled for story {story_id}.")
        finally:
            STREAM_STATE.pop(story_id, None)
            print(f"Stream for {story_id} closed and cleaned up.")

    return EventSourceResponse(event_generator())

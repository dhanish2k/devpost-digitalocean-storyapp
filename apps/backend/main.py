from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
import asyncio
import json
import uuid
import random
from pydantic import BaseModel
from typing import Dict

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for active story streams.
# For production, this should be a distributed message queue like Redis Pub/Sub.
STREAM_STATE: Dict[str, asyncio.Queue] = {}

class StoryPart(BaseModel):
    content: str

@app.get("/")
def read_root():
    return {"Hello": "World"}

STORY_PARTS = [
    "Once upon a time, in a kingdom surrounded by misty mountains, there lived a young inventor named Elara.",
    "Elara had built a mechanical bird that could sing melodies no human had ever heard.",
    "One stormy night, the bird suddenly spoke: 'Elara, the mountains are waking up.'",
    "She looked outside and saw the peaks glowing with an ancient, amber light.",
    "Without hesitation, she grabbed her toolkit and set off toward the nearest summit.",
    "Along the way, she met a wandering cartographer who had been mapping paths that didn't exist yesterday.",
    "'The mountains are reshaping themselves,' he warned. 'Something underground is stirring.'",
    "Together, they followed a freshly carved trail into a cavern of crystallized sound.",
    "Every step they took echoed back as music — the walls were alive with frozen harmonies.",
    "At the heart of the cavern, they found it: an enormous, slumbering automaton, older than the kingdom itself.",
]

async def simulate_story(story_id: str, queue: asyncio.Queue):
    """Background task that pushes story parts automatically."""
    for part in STORY_PARTS:
        await asyncio.sleep(random.uniform(1.5, 3.0))
        if story_id not in STREAM_STATE:
            break
        await queue.put({"type": "text", "content": part})

@app.post("/story")
async def create_story():
    """Creates a new story session and returns a unique story_id."""
    story_id = str(uuid.uuid4())
    return {"story_id": story_id}

@app.post("/story/{story_id}/trigger")
async def trigger_event(story_id: str, part: StoryPart):
    """
    A demo endpoint to simulate an agent worker pushing a new story part.
    """
    if story_id in STREAM_STATE:
        # Create the event data structure
        event_data = {"type": "text", "content": part.content}
        # Put the data into the queue for the corresponding stream
        await STREAM_STATE[story_id].put(event_data)
        return {"status": "success", "message": f"Event triggered for story {story_id}"}
    else:
        return {"status": "error", "message": f"No active stream for story {story_id}"}

@app.get("/stream/{story_id}")
async def message_stream(request: Request, story_id: str):
    """
    Streams story updates to the client using Server-Sent Events.
    """
    # Create a new queue for this client's connection
    queue = asyncio.Queue()
    STREAM_STATE[story_id] = queue

    # Start the background story simulation
    asyncio.create_task(simulate_story(story_id, queue))

    async def event_generator():
        try:
            # First, send a confirmation that the connection is open
            yield {
                "event": "stream_open",
                "data": json.dumps({"message": f"Streaming ready for story {story_id}"})
            }
            while True:
                # Check if the client has disconnected
                if await request.is_disconnected():
                    print(f"Client for story {story_id} disconnected.")
                    break

                # Wait for a new message from the queue and send it
                data = await queue.get()
                yield {"event": "story_update", "data": json.dumps(data)}

        except asyncio.CancelledError:
            print(f"Connection cancelled for story {story_id}.")
        finally:
            # Clean up the queue when the connection is closed
            if story_id in STREAM_STATE:
                del STREAM_STATE[story_id]
            print(f"Stream for {story_id} closed and cleaned up.")

    return EventSourceResponse(event_generator())

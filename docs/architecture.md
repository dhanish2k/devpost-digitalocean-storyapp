# Application Architecture — Storytime

This document covers the full system: monorepo layout, frontend pages, backend routes, the SSE streaming pipeline, the agent call sequence, and the planned evolution to Postgres + Redis.

---

## Monorepo Layout

```
devpost-digitalocean-storyapp/
├── apps/
│   ├── backend/                  Python 3.11 — FastAPI
│   │   ├── main.py               App entry point, routes, SSE generator
│   │   ├── seed_agent.py         pydantic-ai seed agent
│   │   ├── story_agent.py        pydantic-ai story agent
│   │   ├── image_prompt_agent.py pydantic-ai image prompt agent
│   │   ├── fal_client.py         FLUX image gen + ElevenLabs TTS client
│   │   ├── pyproject.toml        Python dependencies (uv workspace)
│   │   └── .env                  Local secrets (gitignored)
│   └── frontend/                 Next.js 16 App Router — TypeScript
│       └── src/
│           ├── app/
│           │   ├── page.tsx              Parent prompt form (/)
│           │   ├── select/page.tsx       Seed story selector (/select)
│           │   └── story/[id]/page.tsx   Story reader (/story/:id)
│           ├── components/
│           │   └── StoryLoader.tsx       Animated loading state
│           └── lib/
│               └── api.ts               NEXT_PUBLIC_API_URL helper
├── packages/
│   └── ai-definitions/           Shared Python package
│       └── ai_definitions/
│           └── __init__.py       Pydantic models: ParentPrompt, StoryPage, all SSE events
└── .do/
    └── app.yaml                  DigitalOcean App Platform spec
```

**Build system:** Turborepo (JS monorepo) + uv workspace (Python).

**Shared types:** `packages/ai-definitions` is a Python package installed into the backend workspace. It defines all domain models (`ParentPrompt`, `SeedOption`, `StoryPage`) and all SSE event models (`SeedOptionsEvent`, `ImageReadyEvent`, etc.) in one place, preventing drift between the agent code that emits events and the route code that serialises them.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | Next.js 16, App Router, React 19 |
| Styling | Tailwind CSS v4 |
| Frontend language | TypeScript |
| Backend framework | FastAPI + uvicorn |
| Backend language | Python 3.11 |
| SSE library | sse-starlette |
| AI framework | pydantic-ai-slim[openai] |
| LLM provider | DigitalOcean Gradient AI (OpenAI-compatible) |
| Image gen | FLUX Schnell via DO Gradient AI async-invoke |
| TTS | ElevenLabs multilingual v2 via DO Gradient AI async-invoke |
| Observability | Logfire (pydantic.dev) |
| Deployment | DigitalOcean App Platform |

---

## Frontend: Three Pages

### 1. `/` — Parent Prompt Form (`page.tsx`)

The parent fills in the child's profile and describes their day. Preferences (name, age, avatar, story length, narration, language) are persisted to `localStorage` using `useSyncExternalStore` — this avoids hydration mismatches and means the form re-opens pre-filled on the next visit.

**On submit:**
```
POST /api/story  { child_name, child_age, description, child_gender,
                   child_archetype, story_length, narration_enabled, language }
         ▼
{ story_id: "uuid" }
         ▼
router.push(`/select?story_id=${story_id}`)
```

The `story_id` is the session key for all subsequent SSE events.

**Child customisation options:**
- Name + age (4–11 slider)
- Avatar/archetype: Knight, Hero, Fairy, Princess, Wizard, Explorer — sets `child_gender` and `child_archetype`
- Story length: Short (3 pages), Medium (5 pages), Long (8 pages)
- Auto-narration toggle
- Language: English / Español

---

### 2. `/select` — Seed Story Selection (`select/page.tsx`)

Immediately on mount, opens an `EventSource` to `GET /api/stream/{story_id}`. The seed agent is already running in the background (started by the POST). The page listens for two event types:

| Event | Action |
|-------|--------|
| `seed_options` | Stores the 3 seed options in state, but keeps the loader visible |
| `seed_image_ready` | Adds the image URL to the seed card. Once all 3 images arrive, hides the loader and reveals the grid |

This design means the parent sees a fully illustrated 3-up grid rather than a text-only list while images load.

**Fallback:** if images haven't all arrived within 30 seconds (e.g. FLUX failure), the page reveals with whatever images are available.

**On "Choose this story":**
```
POST /api/story/{story_id}/select  { seed_id }
         ▼
{ status: "ok" }
         ▼
router.push(`/story/${story_id}`)
```

The `EventSource` is closed at this point. The story agent starts running on the backend immediately.

---

### 3. `/story/[id]` — Story Reader (`story/[id]/page.tsx`)

Opens a fresh `EventSource` to the same `/api/stream/{story_id}` endpoint. The queue on the backend has been producing events since the story agent started; the EventSource consumer catches up from wherever the queue is.

The page maintains a `pageMap: Record<number, StoryPage>` that accumulates patches as events arrive:

| Event | Action |
|-------|--------|
| `story_page` | Adds `{ text }` for page N |
| `image_ready` | Patches `{ image_url }` onto page N |
| `narration_ready` | Patches `{ audio_url }` onto page N |
| `story_complete` | Sets `complete = true` (enables "The End" and last-page detection) |
| `stream_done` | Closes the EventSource (all media has been delivered) |

**First-page gate:** the reader shows a loader until page 1 has text + image + audio (if narration enabled). This ensures the first impression is a complete, polished page — not a flash of partial content.

**Auto-narration:** when a page's audio URL arrives, the reader auto-plays it. On audio end, it automatically advances to the next page if text is ready.

**Navigation:** Prev/Next buttons. The Next button shows a spinner if the next page's text hasn't arrived yet.

---

## Backend: FastAPI Routes

All routes are mounted at `/` but served under the `/api` path prefix in production via DO App Platform routing. In local dev, Next.js rewrites handle `/api/*` → `http://localhost:8080/*`.

### `POST /story`

Creates a new story session.

```python
story_id = str(uuid.uuid4())
queue = asyncio.Queue()
STREAM_STATE[story_id] = queue
state = {"prompt": prompt, "seeds": []}
STORY_STATE[story_id] = state
asyncio.create_task(run_seed_agent(story_id, prompt, queue, state))
return {"story_id": story_id}
```

The queue is created *here*, before the client connects to `/stream`. This is intentional — it prevents a race condition where the seed agent could finish and push events to a queue that doesn't exist yet.

### `POST /story/{story_id}/select`

Fires the story agent for the chosen seed.

```python
seed = next((s for s in state["seeds"] if s["seed_id"] == seed_id), None)
asyncio.create_task(run_story_agent(seed, child_name, child_age, queue, ...))
return {"status": "ok"}
```

The same queue is reused. The story agent's events are consumed by the `/story/[id]` page's EventSource.

### `GET /stream/{story_id}`

The SSE endpoint. Returns an `EventSourceResponse` wrapping an async generator:

```python
async def event_generator():
    yield {"event": "stream_open", "data": ...}
    while True:
        try:
            data = await asyncio.wait_for(queue.get(), timeout=25.0)
        except asyncio.TimeoutError:
            yield {"comment": "keepalive"}  # prevents browser timeout
            continue
        yield {"event": data.get("event"), "data": json.dumps(data)}
        if data.get("event") in ("stream_done", "error"):
            break
```

**Why `asyncio.wait_for` with keepalive instead of `request.is_disconnected()`:**
`is_disconnected()` caused premature cancellation of long LLM calls. The keepalive comment (SSE comments starting with `:`) keeps the connection alive without sending a data event, and the generator runs to `stream_done` regardless of whether the client is still connected.

**Why the queue is not cleaned up on disconnect:**
The queue is preserved so that if the client reconnects (page refresh, network hiccup), it can catch up on events that were already delivered to the queue. In production with Redis this maps to a consumer group with an unacknowledged-messages replay window.

---

## End-to-End Event Flow

```
Browser                    FastAPI                  pydantic-ai Agents        DO Gradient AI / FAL
───────                    ───────                  ──────────────────        ────────────────────

POST /story ─────────────► create queue + state
                            asyncio.create_task(
◄──── { story_id } ──────    run_seed_agent)

GET /stream/{id} ────────► EventSource open

                                                  seed-agent.run()
                                                  ─────────────────────────► chat llama3.3-70b
                                                  ◄────────────────────────── SeedGenerationResult
                                                  queue.put(seed_options)
◄── event: seed_options ──◄ queue.get()

                                                  asyncio.create_task(
                                                    _generate_seed_image x3) ─► FLUX async-invoke x3
                                                                              ◄─ image URLs
                                                  queue.put(seed_image_ready) x3
◄─ event: seed_image_ready x3

[parent selects seed]

POST /story/{id}/select ─► asyncio.create_task(
◄──── { status: ok } ─────   run_story_agent)

[router.push /story/:id]

GET /stream/{id} ────────► EventSource open (same queue, same story_id)

                                                  story-agent.run()
                                                  ─────────────────────────► chat llama3.3-70b
                                                  ◄────────────────────────── StoryGenerationResult
                                                  for page in pages:
                                                    queue.put(story_page)
◄── event: story_page ────◄                       asyncio.create_task(
                                                    _generate_page_media)

                                                    per page (parallel):
                                                    ├─ enhance_image_prompt ─► chat llama3.3-70b
                                                    │                        ◄─ enhanced prompt
                                                    │                          ─► FLUX async-invoke
                                                    │                          ◄─ image URL
                                                    │  queue.put(image_ready)
◄── event: image_ready ───◄
                                                    └─ generate_tts ─────────► ElevenLabs async-invoke
                                                                             ◄─ audio URL
                                                       queue.put(narration_ready)
◄─ event: narration_ready ◄

                                                  queue.put(story_complete)
◄─ event: story_complete ─◄
                                                  await gather(*media_tasks)
                                                  queue.put(stream_done)
◄─ event: stream_done ────◄ EventSource closes
```

---

## In-Memory State (Current)

Two module-level dicts act as the session store:

```python
STREAM_STATE: Dict[str, asyncio.Queue] = {}   # story_id → event queue
STORY_STATE:  Dict[str, dict]          = {}   # story_id → { prompt, seeds }
```

This works for a single-process server. It does not survive restarts or scale across multiple instances.

---

## Production Evolution: Postgres + Redis

The in-memory dicts are an explicit temporary measure. The migration path is designed to be incremental.

### Phase 1 — Auth + Persistence (post-hackathon)

**Database:** DigitalOcean Managed PostgreSQL, accessed via SQLAlchemy async + Alembic migrations.

**Auth:** NextAuth.js (Auth.js v5) — Google OAuth and magic-link email. Session stored server-side in Next.js App Router.

**Schema:**

```sql
users        (id, email, name, created_at)
children     (id, user_id, name, age, archetype, gender, language)
stories      (id, child_id, seed_id, story_length, status, created_at)
story_seeds  (id, story_id, title, setting, values, synopsis, image_url)
story_pages  (id, story_id, page_number, text, image_url, audio_url)
```

**What changes:**
- `POST /story` writes a `stories` row; `STORY_STATE` is replaced with a DB query.
- On story complete, `story_pages` rows are written. Families can revisit completed stories.
- `asyncio.Queue` remains for the *live* SSE stream during generation — it is fast and sufficient for a single process.

### Phase 2 — Queue-Backed SSE

Replace `asyncio.Queue` with a `story_events` DB table polled by the SSE generator. This decouples the story generator from the SSE consumer and survives process restarts and reconnections.

```sql
story_events (id, story_id, event_type, payload jsonb, created_at, sequence_number)
```

The SSE generator becomes:
```python
# Poll for new events since last delivered sequence number
while True:
    new_events = await db.fetch(
        "SELECT * FROM story_events WHERE story_id=$1 AND sequence_number > $2",
        story_id, last_seq
    )
    for ev in new_events:
        yield ev
        last_seq = ev.sequence_number
    await asyncio.sleep(0.5)
```

This enables:
- **Reconnection with replay** — client reconnects and gets missed events from the DB.
- **Multi-tab support** — two browser tabs on the same story both get all events.
- **Process restart recovery** — generation can resume from where it left off.

### Phase 3 — Redis Pub/Sub for Scale

Replace DB polling with Redis pub/sub when multiple backend instances are needed.

**Architecture:**

```
Story Generator Process                    SSE Consumer Process
──────────────────────────                 ─────────────────────
story-agent.run()
  │ for each event:
  ├─ RPUSH story:{id}:events  {payload}    BLPOP story:{id}:events (blocking pop)
  └─ PUBLISH story:{id}       {payload} ──►SUBSCRIBE story:{id}
                                                │
                                           EventSource generator
                                           ◄── yield event
```

Each `story_id` gets its own Redis channel (`story:{id}`). Every backend instance subscribed to the channel receives every event. This is the same pub/sub topology used by chat applications.

**Session isolation:** Each user/story gets a dedicated channel key — there is no cross-contamination between concurrent stories. Redis keyspace expiry (e.g. 24h TTL on the list) handles cleanup.

**Why Redis is the right choice at scale:**
- Sub-millisecond pub/sub latency
- Built-in list persistence for reconnection replay (`LRANGE story:{id}:events 0 -1`)
- Horizontal scaling — any backend replica can produce or consume events

### Migration Path Summary

| Phase | Queue | Persistence | Auth |
|-------|-------|-------------|------|
| Current | `asyncio.Queue` (in-memory) | None | None |
| Phase 1 | `asyncio.Queue` (live) | PostgreSQL (completed stories) | NextAuth.js |
| Phase 2 | DB table polling | PostgreSQL (all events + stories) | NextAuth.js |
| Phase 3 | Redis pub/sub | PostgreSQL (long-term) + Redis (live) | NextAuth.js |

---

## Deployment: DigitalOcean App Platform

The app is deployed as two services from a single repo via `.do/app.yaml`:

```yaml
services:
  - name: backend
    dockerfile_path: Dockerfile
    routes:
      - path: /api
    envs:
      - MODEL_ACCESS_KEY   (SECRET)
      - SEED_MODEL_NAME    llama3.3-70b-instruct
      - STORY_MODEL_NAME   llama3.3-70b-instruct
      - LOGFIRE_TOKEN      (SECRET)
      - ENVIRONMENT        production
      - ALLOWED_ORIGIN     ${APP_URL}

  - name: frontend
    dockerfile_path: apps/frontend/Dockerfile
    routes:
      - path: /
    envs:
      - NEXT_PUBLIC_API_URL  /api   (BUILD_TIME)
```

**Routing:** DO App Platform routes `/api/*` to the backend and everything else to the frontend. The frontend uses `NEXT_PUBLIC_API_URL=/api` (a relative URL), so all API calls go through the same DO origin — no CORS issues in production.

**`ALLOWED_ORIGIN=${APP_URL}`:** The backend's CORS middleware accepts the app's own URL as the only allowed origin in production. `${APP_URL}` is a DO-provided variable that resolves to the deployment URL.

**CORS in local dev:** The backend defaults to `http://localhost:3000` when `ALLOWED_ORIGIN` is not set.

---

## `reactStrictMode: false`

Set in `next.config.ts`. React Strict Mode double-invokes effects in development, which would open two `EventSource` connections per page and double-consume queue events. Disabled to keep SSE behaviour predictable during development.

---

## Shared Types: `ai-definitions` Package

The `packages/ai-definitions` Python package is the contract between the backend's agent layer and its HTTP layer. All Pydantic models used in SSE events are defined here, so:

1. Agent code (`seed_agent.py`, `story_agent.py`) imports domain types and SSE event types.
2. Route code (`main.py`) imports `ParentPrompt` for request validation.
3. There is one source of truth for every field name, type, and default.

The frontend TypeScript types in the page files are manually mirrored from these Pydantic models. A future improvement would be to generate TypeScript types from the Pydantic JSON schemas at build time.

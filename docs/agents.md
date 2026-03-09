# Agentic Architecture — Storytime

This document covers how AI agents are structured, how pydantic-ai is used, how structured output extraction works, how prompts are designed, and how the system is observed via Logfire.

---

## Overview

Storytime uses three specialised pydantic-ai agents that form a sequential pipeline:

```
ParentPrompt
    │
    ▼
┌─────────────┐     3 × SeedOption (title, setting, values, synopsis)
│  Seed Agent │────────────────────────────────────────────────────────►  Parent selects one
└─────────────┘     3 × FLUX image (parallel, async)
                                                  │
                                                  ▼
                                      ┌───────────────────┐
                                      │   Story Agent     │   StoryGenerationResult
                                      │  (full narrative) │──────────────────────────►  N pages streamed
                                      └───────────────────┘
                                              │
                                    per page (parallel):
                                              ├──► Image Prompt Agent  ──► FLUX image
                                              └──► TTS (ElevenLabs)    ──► audio URL
```

All three agents call the **DigitalOcean Gradient AI** inference endpoint (`https://inference.do-ai.run/v1/`), which exposes an OpenAI-compatible API.

---

## Library: pydantic-ai

The project uses `pydantic-ai-slim[openai]` — the minimal distribution that includes only the OpenAI provider. This is the correct production choice; the full `pydantic-ai` package pulls in every provider's SDK.

```
pydantic-ai-slim[openai]   # ~91 fewer transitive packages than full pydantic-ai
```

### How pydantic-ai Extracts Structured Output

pydantic-ai does **not** use response parsing. It uses the model's native tool-calling mechanism:

1. It inspects the `output_type` Pydantic model and generates a JSON Schema from it.
2. It registers that schema as a single tool called `final_result`.
3. It calls the model with `tool_choice="required"` — the model *must* call the tool.
4. The model returns a `tool_calls` block containing the arguments as JSON.
5. pydantic-ai calls `model_validate(tool_arguments)` on the declared `output_type`.
6. If validation fails, the validation error is fed back to the model as a new message and the model retries (up to a configurable limit).

**Implication:** any model used with structured output *must* support tool calling. Models that only support text completion (like `deepseek-r1-distill-llama-70b` on DO's API) will return an HTTP error immediately. `llama3.3-70b-instruct` is the confirmed working model.

### Schema Complexity and `$defs`

Pydantic models that reference other models generate `$defs` / `$ref` in the JSON Schema. For example, `StoryGenerationResult` references `CharacterDefinition` and `StoryPage`, producing:

```json
{
  "$defs": {
    "CharacterDefinition": { ... },
    "StoryPage": { ... }
  },
  "properties": {
    "characters": { "items": { "$ref": "#/$defs/CharacterDefinition" }, ... },
    "pages": { "items": { "$ref": "#/$defs/StoryPage" }, ... }
  }
}
```

Smaller or less capable models (tested: `llama3-8b-instruct`) cannot process `$defs` schemas and return validation errors. `llama3.3-70b-instruct` handles them correctly.

---

## The Three Agents

### 1. Seed Agent (`seed_agent.py`)

**Purpose:** Given a `ParentPrompt`, generate 3 distinct story concepts for the parent to choose from.

**Output type:** `SeedGenerationResult` — a thin wrapper around `list[_SeedDraft]`.

**Key design: `_SeedDraft` vs `SeedOption`**

The LLM output type deliberately excludes `seed_id`:

```python
class _SeedDraft(BaseModel):
    title:    str       = Field(description="Story title")
    setting:  str       = Field(description="One-phrase world description")
    values:   list[str] = Field(description="2-4 emotional themes")
    synopsis: str       = Field(description="2-3 sentence teaser for the parent")

class SeedGenerationResult(BaseModel):
    seeds: list[_SeedDraft]
```

After the agent call, `seed_id` is generated server-side with `uuid4()`:

```python
seeds = [
    SeedOption(seed_id=str(uuid.uuid4()), **draft.model_dump())
    for draft in result.output.seeds
]
```

This prevents a class of validation errors where the model would either omit `seed_id` or hallucinate a value for it.

**Field descriptions** on `_SeedDraft` are included in the JSON Schema and appear in the tool definition sent to the model — they act as inline documentation that improves output quality.

**Model:** `SEED_MODEL_NAME` env var → fallback `llama3.3-70b-instruct`
**Timeout:** 60 seconds (`ModelSettings(timeout=60.0)`)

---

### 2. Story Agent (`story_agent.py`)

**Purpose:** Given a chosen seed and child profile, generate a complete illustrated story.

**Output type:** `StoryGenerationResult` — characters + pages.

```python
class CharacterDefinition(BaseModel):
    name: str
    visual_description: str   # precise visual for the illustrator agent

class StoryGenerationResult(BaseModel):
    characters: list[CharacterDefinition]
    pages: list[StoryPage]
```

The `characters` field is the key innovation: the story agent produces a canonical visual description for every named character *once*, upfront. This description is then threaded into every subsequent image prompt, ensuring visual consistency across all pages without asking the model to re-describe characters each time.

**Page count:** controlled by `story_length` from the `ParentPrompt`:

```python
_PAGE_COUNTS = {"short": 3, "medium": 5, "long": 8}
```

**Model:** `STORY_MODEL_NAME` env var → fallback `llama3.3-70b-instruct`
**Timeout:** 120 seconds (`ModelSettings(timeout=120.0)`)

---

### 3. Image Prompt Agent (`image_prompt_agent.py`)

**Purpose:** Convert a raw one-sentence scene description into a FLUX-optimised image prompt with embedded character visuals, lighting, composition, and art style.

**Output type:** `str` — pydantic-ai uses a plain-string extraction (no schema, no tool, just text output).

This agent runs in parallel with TTS generation for each page, so it adds zero net latency to the story stream.

**Input:**
```
Setting: enchanted forest
Characters: Luna: 7-year-old girl, short dark hair, round glasses, blue raincoat
Scene to illustrate: Luna places the glowing acorn at the base of the ancient oak
```

**Output (example):**
```
A 7-year-old girl with short dark hair, round glasses, and a blue raincoat crouches at the base
of an enormous ancient oak, gently setting down a softly glowing golden acorn at its roots.
Warm dappled moonlight filters through the canopy above. Wide establishing shot, slightly
low angle, cozy mysterious atmosphere. Soft watercolor illustration, children's book style,
warm color palette, no text, no words.
```

**Model:** `MODEL_NAME` env var → fallback `llama3.3-70b-instruct`
**Timeout:** 60 seconds (`ModelSettings(timeout=60.0)`)

---

## Prompt Engineering

### No-Question Directive

All agents include a hard directive at the top of their system prompts:

```
When given a [brief], you IMMEDIATELY output [result] —
no questions, no clarifications, no preamble.
```

And the user prompt ends with:

```
Generate immediately. Do not ask questions.
```

Without this, instruction-tuned models (especially reasoning models) treat the prompt as the start of a conversation and ask clarifying questions before acting.

### Show, Don't Tell — Emotional Subtext

The story agent system prompt contains an explicit prohibition on naming feelings or morals:

```
NEVER name a value, lesson, or moral in the text. No "forgiveness", "kindness",
"courage", "friendship", etc. The meaning must emerge entirely from what characters
DO and what happens.

NEVER name what a character feels. No "felt proud", "felt happy", "felt scared".
Instead write what their body does or what they notice: shoulders drop, breath
comes slow, hands stop shaking.
```

This is the creative core of the product — stories feel emotionally resonant without being didactic.

### Climax Enforcement

A common LLM failure mode in stories is jumping from "facing the threat" to "it was resolved" without showing the actual action. The system prompt addresses this explicitly:

```
NEVER skip the climactic moment. The page where the protagonist faces the obstacle
MUST show the exact action they take to overcome it — one concrete, specific thing
they do, say, or use.
```

### Language Support

Both seed and story agents support bilingual output. A language hint is appended to the user prompt:

```python
+ ("\n\nIMPORTANT: Write ALL output in Spanish." if p.language == "es" else "")
```

---

## Agent Lifecycle and Singleton Pattern

Each agent is a module-level singleton, lazily initialised on first use:

```python
_agent: Agent[None, SeedGenerationResult] | None = None

def get_seed_agent() -> Agent[None, SeedGenerationResult]:
    global _agent
    if _agent is None:
        key = os.getenv("MODEL_ACCESS_KEY")
        model = OpenAIChatModel(
            os.getenv("SEED_MODEL_NAME") or os.getenv("MODEL_NAME", "llama3.3-70b-instruct"),
            provider=OpenAIProvider(base_url="https://inference.do-ai.run/v1/", api_key=key),
        )
        _agent = Agent(model, name="seed-agent", output_type=SeedGenerationResult,
                       system_prompt=_SYSTEM_PROMPT, model_settings=ModelSettings(timeout=60.0))
    return _agent
```

The `name=` parameter on `Agent()` controls how the agent appears in Logfire traces — without it, all agents show as `_agent_run`.

Each agent call creates a new pydantic-ai `RunContext` (conversation thread), so agents are stateless across story requests.

---

## Observability with Logfire

### Setup

Logfire is configured before the FastAPI app is created, in `main.py`:

```python
import logfire

logfire.configure(
    send_to_logfire="if-token-present",   # local dev without token = local only
    service_name="storytime-backend",
    environment=os.getenv("ENVIRONMENT", "development"),
)
logfire.instrument_pydantic_ai()  # wraps all Agent.run() calls with spans
logfire.instrument_httpx()        # traces all outbound HTTP (LLM calls, image gen, TTS)
# ... create FastAPI app ...
logfire.instrument_fastapi(app)   # traces all inbound HTTP requests
```

`send_to_logfire="if-token-present"` means:
- **Local dev** (no `LOGFIRE_TOKEN`): traces are logged locally, nothing sent to the cloud.
- **Production** (`LOGFIRE_TOKEN` set as a DO App Platform secret): traces are sent to `logfire.pydantic.dev`.

### What Gets Traced

| Span | Source |
|------|--------|
| `GET /api/stream/{id}` | FastAPI instrumentation |
| `POST /api/story` | FastAPI instrumentation |
| `seed-agent run` | pydantic-ai instrumentation |
| `chat llama3.3-70b-instruct` | pydantic-ai + httpx |
| `image-prompt-agent run` | pydantic-ai instrumentation |
| `story-agent run` | pydantic-ai instrumentation |
| `POST inference.do-ai.run` (image gen, TTS) | httpx instrumentation |

### Environment Tagging

The `ENVIRONMENT` env var (`development` / `production`) is passed to `logfire.configure()`. This lets you filter traces by environment in the Logfire dashboard and avoid local noise polluting production dashboards.

---

## Media Generation: `fal_client.py`

Image generation and TTS are handled through the DO Gradient AI async-invoke API — not through pydantic-ai agents.

```
POST /v1/async-invoke   →  { request_id }
                                │
                    poll GET /v1/async-invoke/{id}/status
                                │ COMPLETED
                    GET /v1/async-invoke/{id}  →  result
```

**Image model:** `fal-ai/flux/schnell` — 4-step FLUX Schnell for fast, high-quality illustrations.

**TTS model:** `fal-ai/elevenlabs/tts/multilingual-v2` — ElevenLabs multilingual voice synthesis.

The client retries 3 times on 5xx errors with exponential backoff (3s, 6s, 9s), and times out after 60 seconds (30 polls × 2s interval).

---

## Model Configuration Reference

| Variable | Default | Used by |
|----------|---------|---------|
| `MODEL_ACCESS_KEY` | — (required) | All agents + fal_client |
| `MODEL_NAME` | `llama3.3-70b-instruct` | Image prompt agent fallback |
| `SEED_MODEL_NAME` | `llama3.3-70b-instruct` | Seed agent |
| `STORY_MODEL_NAME` | `llama3.3-70b-instruct` | Story agent |
| `LOGFIRE_TOKEN` | — (optional) | Logfire cloud export |
| `ENVIRONMENT` | `development` | Logfire environment tag |

> **Note:** `deepseek-r1-distill-llama-70b` does **not** support tool calling via the DO Gradient AI API and will fail with `ModelHTTPError` (253ms fast-fail). Only use models that support OpenAI-compatible tool calling.

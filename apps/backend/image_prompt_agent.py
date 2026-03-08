"""
Enhances raw story scene descriptions into FLUX-optimised image prompts.
Runs in parallel with TTS generation so adds minimal latency.
"""
from __future__ import annotations

import os

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings


_SYSTEM_PROMPT = """\
You are an expert prompt engineer for the FLUX image generation model.

Given a story scene, character descriptions, and setting, rewrite it as a \
rich, detailed FLUX image prompt that will produce a beautiful, consistent \
children's book illustration.

Rules:
- Embed the characters' physical descriptions directly in the prompt (do NOT just say their names)
- Specify lighting: e.g. warm golden hour, soft moonlight, dappled forest light
- Specify composition: e.g. wide establishing shot, close-up, eye-level with child
- Include mood and atmosphere words that match a cosy bedtime story
- Art style must end with: "soft watercolor illustration, children's book style, warm color palette, no text, no words"
- Output ONLY the prompt — no explanation, no quotes, no preamble
- Keep it under 120 words\
"""


_agent: Agent[None, str] | None = None


def _get_agent() -> Agent[None, str]:
    global _agent
    if _agent is None:
        key = os.getenv("MODEL_ACCESS_KEY")
        if not key:
            raise RuntimeError("MODEL_ACCESS_KEY not set")
        model = OpenAIChatModel(
            os.getenv("MODEL_NAME", "llama3.3-70b-instruct"),
            provider=OpenAIProvider(
                base_url="https://inference.do-ai.run/v1/",
                api_key=key,
            ),
        )
        _agent = Agent(model, name="image-prompt-agent", output_type=str, system_prompt=_SYSTEM_PROMPT,
                       model_settings=ModelSettings(timeout=60.0))
    return _agent


async def enhance_image_prompt(scene: str, char_desc: str, setting: str) -> str:
    """Convert a raw scene description into a FLUX-optimised prompt."""
    user_message = (
        f"Setting: {setting}\n"
        f"Characters: {char_desc}\n"
        f"Scene to illustrate: {scene}"
    )
    result = await _get_agent().run(user_message)
    return result.output

"""
Thin async client for fal model inference on DigitalOcean Gradient AI.

Pattern: POST /v1/async-invoke → poll /status → GET result
"""
from __future__ import annotations

import asyncio
import os

import httpx

_BASE = "https://inference.do-ai.run/v1/async-invoke"
_POLL_INTERVAL = 2   # seconds
_MAX_POLLS = 30      # give up after ~60s


def _auth() -> dict:
    key = os.getenv("MODEL_ACCESS_KEY")
    if not key:
        raise RuntimeError("MODEL_ACCESS_KEY not set")
    return {"Authorization": f"Bearer {key}"}


async def _invoke(client: httpx.AsyncClient, model_id: str, input_data: dict) -> str:
    """Submit an async job, return request_id. Retries once on 5xx."""
    for attempt in range(3):
        r = await client.post(
            _BASE,
            json={"model_id": model_id, "input": input_data},
            headers=_auth(),
            timeout=30,
        )
        if r.is_success:
            return r.json()["request_id"]
        if r.status_code < 500 or attempt == 2:
            r.raise_for_status()
        wait = 3 * (attempt + 1)
        print(f"[fal_client] {model_id} invoke got {r.status_code}, retrying in {wait}s...")
        await asyncio.sleep(wait)
    r.raise_for_status()  # unreachable but satisfies type checker


async def _poll_result(client: httpx.AsyncClient, request_id: str) -> dict:
    """Poll until COMPLETED, return the full result dict."""
    status_url = f"{_BASE}/{request_id}/status"
    result_url = f"{_BASE}/{request_id}"

    for _ in range(_MAX_POLLS):
        await asyncio.sleep(_POLL_INTERVAL)
        sr = await client.get(status_url, headers=_auth(), timeout=30)
        sr.raise_for_status()
        status = sr.json().get("status", "UNKNOWN")
        if status == "COMPLETED":
            break
        if status in ("FAILED", "ERROR"):
            raise RuntimeError(f"fal job {request_id} failed: {sr.json()}")
    else:
        raise TimeoutError(f"fal job {request_id} timed out after {_MAX_POLLS * _POLL_INTERVAL}s")

    rr = await client.get(result_url, headers=_auth(), timeout=30)
    rr.raise_for_status()
    return rr.json()


async def generate_image(prompt: str) -> str:
    """Generate an image and return its URL."""
    async with httpx.AsyncClient() as client:
        request_id = await _invoke(client, "fal-ai/flux/schnell", {
            "prompt": prompt,
            "output_format": "jpeg",
            "num_inference_steps": 4,
            "num_images": 1,
            "enable_safety_checker": True,
        })
        result = await _poll_result(client, request_id)

    return result["output"]["images"][0]["url"]


async def generate_tts(text: str, language: str = "en") -> str:
    """Generate TTS narration and return the audio URL."""
    input_data: dict = {"text": text}
    if language == "es":
        input_data["language"] = "es"
    async with httpx.AsyncClient() as client:
        request_id = await _invoke(client, "fal-ai/elevenlabs/tts/multilingual-v2", input_data)
        result = await _poll_result(client, request_id)

    # result["output"]["audio"]["url"]
    return result["output"]["audio"]["url"]

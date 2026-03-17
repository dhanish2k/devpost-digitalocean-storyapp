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


def _parse_word_timings(output: dict) -> list[dict]:
    """
    Convert ElevenLabs character-level alignment into word-level timings.
    Works for any language — timing data comes from the audio, not from text heuristics.
    DO Gradient returns timestamps.characters / timestamps.character_start_times_seconds etc.
    """
    alignment = (
        output.get("timestamps")
        or output.get("normalized_alignment")
        or output.get("alignment")
        or {}
    )
    if isinstance(alignment, list):
        alignment = alignment[0] if alignment else {}
    chars  = alignment.get("characters", [])
    starts = alignment.get("character_start_times_seconds", [])
    ends   = alignment.get("character_end_times_seconds", [])

    if not (chars and len(chars) == len(starts) == len(ends)):
        return []

    word_timings: list[dict] = []
    word: str = ""
    word_start: float | None = None

    for ch, start, end in zip(chars, starts, ends):
        if ch in (" ", "\n", "\t"):
            if word:
                word_timings.append({
                    "word": word,
                    "start_ms": int(word_start * 1000),  # type: ignore[arg-type]
                    "end_ms": int(end * 1000),
                })
                word = ""
                word_start = None
        else:
            if not word:
                word_start = start
            word += ch

    if word:  # flush last word
        word_timings.append({
            "word": word,
            "start_ms": int(word_start * 1000),  # type: ignore[arg-type]
            "end_ms": int(ends[-1] * 1000),
        })

    return word_timings


def _split_text(text: str, max_chars: int = 280) -> tuple[str, str | None]:
    """Split text at a sentence boundary if longer than max_chars."""
    if len(text) <= max_chars:
        return text, None
    # Walk backwards from max_chars looking for '. ', '! ', '? '
    for i in range(min(max_chars, len(text) - 1), max_chars // 2, -1):
        if text[i] in ".!?" and i + 1 < len(text) and text[i + 1] == " ":
            return text[:i + 1].strip(), text[i + 1:].strip()
    # Fallback: split at last space
    for i in range(min(max_chars, len(text) - 1), 0, -1):
        if text[i] == " ":
            return text[:i].strip(), text[i:].strip()
    return text, None


async def _tts_single(text: str, language: str = "en", previous_text: str = "") -> tuple[str, list[dict]]:
    """Single TTS call, returns (audio_url, word_timings)."""
    input_data: dict = {"text": text, "timestamps": True}
    if language == "es":
        input_data["language"] = "es"
    if previous_text:
        input_data["previous_text"] = previous_text
    async with httpx.AsyncClient() as client:
        request_id = await _invoke(client, "fal-ai/elevenlabs/tts/multilingual-v2", input_data)
        result = await _poll_result(client, request_id)
    output = result.get("output", {})
    return output["audio"]["url"], _parse_word_timings(output)


async def generate_tts(text: str, language: str = "en") -> tuple[str, str | None, list[dict]]:
    """Generate TTS narration. Splits long texts so word timings cover the full page.
    Returns (audio_url, audio_url_2_or_none, word_timings).
    """
    part1, part2 = _split_text(text)
    if part2 is None:
        url, timings = await _tts_single(part1, language)
        return url, None, timings

    # Both parts in parallel; part2 uses previous_text for voice continuity
    (url1, timings1), (url2, timings2_raw) = await asyncio.gather(
        _tts_single(part1, language),
        _tts_single(part2, language, previous_text=part1),
    )
    # Offset part2 timings so they're absolute relative to the start of audio1
    offset_ms = (timings1[-1]["end_ms"] + 400) if timings1 else 0
    timings2 = [
        {**t, "start_ms": t["start_ms"] + offset_ms, "end_ms": t["end_ms"] + offset_ms}
        for t in timings2_raw
    ]
    return url1, url2, timings1 + timings2

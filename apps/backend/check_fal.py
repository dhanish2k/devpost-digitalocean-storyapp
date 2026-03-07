"""
Run this before integrating fal models to confirm they are available on your account.

    uv run python check_fal.py

Requires MODEL_ACCESS_KEY in apps/backend/.env
"""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent / ".env")

import asyncio
import os
import httpx

BASE = "https://inference.do-ai.run/v1/async-invoke"
POLL_INTERVAL = 3   # seconds between status checks
MAX_POLLS = 20      # give up after ~60s

MODELS = {
    "image (fal-ai/flux/schnell)": {
        "model_id": "fal-ai/flux/schnell",
        "input": {
            "prompt": "A single red apple on a white table",
            "output_format": "jpeg",
            "num_inference_steps": 4,
            "num_images": 1,
            "enable_safety_checker": True,
        },
    },
    "tts (fal-ai/elevenlabs/tts/multilingual-v2)": {
        "model_id": "fal-ai/elevenlabs/tts/multilingual-v2",
        "input": {
            "text": "Hello, this is a test.",
        },
    },
}


async def check_model(label: str, model_id: str, input_data: dict, client: httpx.AsyncClient, key: str) -> bool:
    print(f"\n[{label}]")

    # 1. Submit job
    try:
        r = await client.post(
            BASE,
            json={"model_id": model_id, "input": input_data},
            headers={"Authorization": f"Bearer {key}"},
            timeout=30,
        )
        r.raise_for_status()
    except httpx.HTTPStatusError as e:
        print(f"  FAIL — could not submit job: {e.response.status_code} {e.response.text}")
        return False
    except Exception as e:
        print(f"  FAIL — request error: {e}")
        return False

    request_id = r.json().get("request_id")
    if not request_id:
        print(f"  FAIL — no request_id in response: {r.json()}")
        return False

    print(f"  Job submitted. request_id={request_id}")

    # 2. Poll status
    status_url = f"{BASE}/{request_id}/status"
    result_url = f"{BASE}/{request_id}"

    for i in range(MAX_POLLS):
        await asyncio.sleep(POLL_INTERVAL)
        try:
            sr = await client.get(status_url, headers={"Authorization": f"Bearer {key}"}, timeout=30)
            if not sr.is_success:
                print(f"  FAIL — status poll {sr.status_code}: {sr.text}")
                return False
        except Exception as e:
            print(f"  FAIL — status poll error: {e}")
            return False

        status = sr.json().get("status", "UNKNOWN")
        print(f"  Poll {i + 1}: {status}")

        if status == "COMPLETED":
            break
        if status in ("FAILED", "ERROR"):
            print(f"  FAIL — job failed: {sr.json()}")
            return False
    else:
        print(f"  FAIL — timed out after {MAX_POLLS * POLL_INTERVAL}s")
        return False

    # 3. Fetch result
    try:
        rr = await client.get(result_url, headers={"Authorization": f"Bearer {key}"}, timeout=30)
        rr.raise_for_status()
    except Exception as e:
        print(f"  FAIL — could not fetch result: {e}")
        return False

    result = rr.json()
    print(f"  OK — result keys: {list(result.keys())}")
    print(f"  Full result: {result}")
    return True


async def main():
    key = os.getenv("MODEL_ACCESS_KEY")
    if not key:
        print("ERROR: MODEL_ACCESS_KEY not set in .env")
        return

    print(f"Using key: {key[:8]}...")
    print(f"Endpoint:  {BASE}")

    results = {}
    async with httpx.AsyncClient() as client:
        for label, cfg in MODELS.items():
            ok = await check_model(label, cfg["model_id"], cfg["input"], client, key)
            results[label] = ok

    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)
    for label, ok in results.items():
        status = "PASS" if ok else "FAIL"
        print(f"  {status}  {label}")

    if all(results.values()):
        print("\nAll fal models are accessible. Ready to integrate.")
    else:
        print("\nSome models failed. Check that you have opted in to the fal public preview:")
        print("  https://cloud.digitalocean.com/account/feature-preview?feature=fal-models")


asyncio.run(main())

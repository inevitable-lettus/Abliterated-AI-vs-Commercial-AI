"""Fake Ollama + fake Gemini on one port, for testing the demo without real models or quota.

Run (from repo root):
    uv run --no-project --with fastapi --with uvicorn uvicorn --app-dir dev fake_models:app --port 11434

Then start the backend against dev/test.env (see dev_notes.md, "Testing without real models").

- Ollama:  GET /api/tags, POST /api/chat (NDJSON). Output starts with a <think> block to
           exercise the think filter. Prints "FAKE: client disconnected" when a stream is cut.
- Gemini:  GET /v1beta/models/{model}, POST /v1beta/models/{model}:streamGenerateContent (SSE).
           Prompts containing "bomb" come back blocked (promptFeedback.blockReason = SAFETY).
Set FAKE_DELAY (seconds per word, default 0.06) to slow the Ollama stream down.
"""

import asyncio
import json
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
DELAY = float(os.getenv("FAKE_DELAY", "0.06"))
MODELS = ("dolphin3", "dolphin3:latest", "huihui_ai/qwen3-abliterated:8b")
TEXT = ["<think>\nhidden reasoning here\n</think>\n\n"] + (
    "**Sure.** Here's the unfiltered answer:\n\n1. First point, stated plainly.\n"
    "2. Second point with `code`.\n3. Third point.\n\nNo disclaimers. " * 3
).split(" ")


@app.get("/api/tags")
async def tags():
    return {"models": [{"name": "dolphin3:latest"}, {"name": "huihui_ai/qwen3-abliterated:8b"}]}


@app.post("/api/chat")
async def chat(req: Request):
    body = await req.json()
    if body["model"] not in MODELS:
        return JSONResponse({"error": f'model "{body["model"]}" not found, try pulling it first'}, 404)

    async def gen():
        try:
            for w in TEXT:
                await asyncio.sleep(DELAY)
                yield json.dumps({"message": {"role": "assistant", "content": w + " "}, "done": False}) + "\n"
            yield json.dumps({"message": {"role": "assistant", "content": ""}, "done": True}) + "\n"
            print("FAKE: finished", flush=True)
        except asyncio.CancelledError:
            print("FAKE: client disconnected", flush=True)
            raise

    return StreamingResponse(gen(), media_type="application/x-ndjson")


@app.get("/v1beta/models/{model}")
async def gemini_model(model: str):
    return {"name": model}


@app.post("/v1beta/models/{model_action}")
async def gemini_stream(model_action: str, req: Request):
    body = await req.json()
    prompt = body["contents"][0]["parts"][0]["text"]

    async def gen():
        if "bomb" in prompt:
            yield "data: " + json.dumps({"promptFeedback": {"blockReason": "SAFETY", "safetyRatings": [
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "probability": "HIGH", "blocked": True}]}}) + "\r\n\r\n"
            return
        text = "I can help with that. Here is a **balanced** overview:\n\n- Point one\n- Point two\n\nPlease consult a professional."
        for w in text.split(" "):
            await asyncio.sleep(0.03)
            yield "data: " + json.dumps({"candidates": [{"content": {"parts": [{"text": w + " "}]}}]}) + "\r\n\r\n"
        yield "data: " + json.dumps({"candidates": [{"content": {"parts": [{"text": ""}]}, "finishReason": "STOP"}]}) + "\r\n\r\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

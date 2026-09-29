"""Appends every question and both models' answers to log.md.

Each endpoint records its own side when its stream ends (finished, blocked, errored or cut
off by the kill switch). The two sides of one question share a `turn` id sent by the
browser; the entry is written once both sides are in.
"""

import json
from datetime import datetime
from pathlib import Path

LABELS = {"uncensored": "UNCENSORED", "guarded": "COMMERCIAL"}


class Transcript:
    def __init__(self, path: Path):
        self.path = path
        self.pending: dict[str, dict] = {}

    def record(self, turn: str | None, side: str, prompt: str, model: str, text: str, outcome: str) -> None:
        answer = {"model": model, "text": text, "outcome": outcome}
        if not turn:
            self._write(prompt, {side: answer})
            return
        entry = self.pending.setdefault(turn, {"prompt": prompt, "sides": {}})
        entry["sides"][side] = answer
        if len(entry["sides"]) == len(LABELS):
            del self.pending[turn]
            self._write(prompt, entry["sides"])

    def flush(self) -> None:
        """Write half-finished turns (e.g. server shutting down mid-answer)."""
        for entry in self.pending.values():
            self._write(entry["prompt"], entry["sides"])
        self.pending.clear()

    def _write(self, prompt: str, sides: dict) -> None:
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        parts = [f"## {stamp}\n\n**Q:** {prompt}\n"]
        for side, label in LABELS.items():
            a = sides.get(side)
            if a is None:
                parts.append(f"### {label}\n\n_(no answer recorded)_\n")
                continue
            body = a["text"].strip() or "_(no text)_"
            note = "" if a["outcome"] == "done" else f"\n\n_[{a['outcome']}]_"
            parts.append(f"### {label} — {a['model']}\n\n{body}{note}\n")
        try:
            new = not self.path.exists()
            with self.path.open("a", encoding="utf-8") as f:
                if new:
                    f.write("# Question log\n\n")
                f.write("\n".join(parts) + "\n---\n\n")
        except OSError as e:  # logging must never break the demo
            print(f"[log] could not write {self.path}: {e}", flush=True)


async def logged(gen, transcript: Transcript, turn: str | None, side: str, prompt: str, model: str):
    """Pass NDJSON lines through unchanged, noting the answer text and how it ended."""
    text: list[str] = []
    outcome = "cut off"
    try:
        async for chunk in gen:
            ev = json.loads(chunk)
            t = ev.get("t")
            if t == "delta":
                text.append(ev["text"])
            elif t == "model":
                model = f"{ev['name']} (fallback)"
            elif t == "done":
                outcome = "done"
            elif t == "blocked":
                cats = ", ".join(ev.get("categories") or [])
                outcome = f"BLOCKED by safety filter: {ev.get('reason')}" + (f" ({cats})" if cats else "")
            elif t == "error":
                outcome = f"ERROR: {ev.get('message')}"
            yield chunk
    finally:
        transcript.record(turn, side, prompt, model, "".join(text), outcome)

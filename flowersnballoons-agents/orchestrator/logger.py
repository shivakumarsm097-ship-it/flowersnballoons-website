"""Structured action log — same shape as the SalaryAsk system:
{ts, module, actions_taken, actions_skipped_or_escalated, errors}

One JSONL file per module per day under logs/. Every payment-confirming
action and every vendor-assignment action MUST pass through log_action().
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR = Path(os.environ.get("LOG_DIR", Path(__file__).resolve().parent.parent / "logs"))


def _write(module: str, entry: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = LOG_DIR / f"{module}-{day}.jsonl"
    with path.open("a") as f:
        f.write(json.dumps(entry, default=str) + "\n")


def log_action(
    module: str,
    actions_taken: list[str] | None = None,
    actions_skipped_or_escalated: list[str] | None = None,
    errors: list[str] | None = None,
) -> None:
    _write(
        module,
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "module": module,
            "actions_taken": actions_taken or [],
            "actions_skipped_or_escalated": actions_skipped_or_escalated or [],
            "errors": errors or [],
        },
    )

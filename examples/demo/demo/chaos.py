"""Injectable faults: one active incident per app, set through `/_chaos`.

With a `stage`, the extra latency is spent inside that stage and errors are raised from it, so
only routes that pass through the stage are affected and the stage histogram shows the cause.
Without a stage, the latency is added to the whole request outside any stage (like a slow
network or a GC pause) and errors hit every route except /healthz.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

STAGES = ("ingress", "auth", "embed", "infer", "rank", "egress")
Stage = Literal["ingress", "auth", "embed", "infer", "rank", "egress"]


class ChaosRequest(BaseModel):
    latency_ms: float = Field(0, ge=0, le=10_000)
    error_rate: float = Field(0, ge=0, le=1)
    stage: Stage | None = None
    duration_s: float = Field(120, gt=0, le=86_400)


@dataclass
class Chaos:
    latency_ms: float = 0
    error_rate: float = 0
    stage: str | None = None
    until: float = 0  # time.monotonic(); 0 = nothing active

    def set(self, req: ChaosRequest) -> None:
        self.latency_ms = req.latency_ms
        self.error_rate = req.error_rate
        self.stage = req.stage
        self.until = time.monotonic() + req.duration_s

    def clear(self) -> None:
        self.latency_ms = self.error_rate = self.until = 0
        self.stage = None

    def active(self) -> bool:
        # Expiry is checked lazily on each request: no timer task to cancel or leak.
        if self.until and time.monotonic() >= self.until:
            self.clear()
        return self.until > 0

    def describe(self) -> dict:
        if not self.active():
            return {"active": False}
        return {
            "active": True,
            "latency_ms": self.latency_ms,
            "error_rate": self.error_rate,
            "stage": self.stage,
            "remaining_s": round(self.until - time.monotonic(), 1),
        }

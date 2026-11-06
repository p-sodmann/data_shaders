"""Rate limit for exemplars: ADR-0003 wants about one per second per node, not one per request."""

from __future__ import annotations

from time import monotonic


class TokenBucket:
    def __init__(self, rate: float):
        self.rate = rate
        # Allow a short burst of one second's worth, but at least one token.
        self.capacity = max(1.0, rate)
        # Start full, so the first request after startup carries an exemplar.
        self.tokens = self.capacity
        self.last = monotonic()

    def take(self) -> bool:
        if self.rate <= 0:
            return False
        now = monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False

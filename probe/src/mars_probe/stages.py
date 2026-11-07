"""`stage("name")`: time a block or a function into mars_stage_duration_seconds.

Inside a request the stage records to the probe of the app that is serving it (a context
variable set by the middleware, which also reaches sync endpoints run in the threadpool).
Outside a request it records to the most recently instrumented app, and without any probe it
does nothing, so library code can use stages unconditionally.
"""

from __future__ import annotations

import functools
import inspect
from collections.abc import Callable
from contextvars import ContextVar, Token
from time import perf_counter
from typing import TYPE_CHECKING, Any, Literal, TypeVar

if TYPE_CHECKING:
    from .probe import Probe

F = TypeVar("F", bound=Callable[..., Any])

_current: ContextVar[Probe | None] = ContextVar("mars_probe_current", default=None)
_default: Probe | None = None


def set_default(probe: Probe) -> None:
    global _default
    _default = probe


def enter(probe: Probe) -> Token[Probe | None]:
    return _current.set(probe)


def leave(token: Token[Probe | None]) -> None:
    _current.reset(token)


class stage:  # noqa: N801 - used like a function: `with stage("embed")`, `@stage("rank")`
    __slots__ = ("name", "probe", "_starts")

    def __init__(self, name: str, probe: Probe | None = None) -> None:
        self.name = name
        self.probe = probe
        # A stack, so one instance can be re-entered (nested or recursive use).
        self._starts: list[float] = []

    def __enter__(self) -> stage:
        # The pipeline order (mars_stage_info) is the order stages are first entered: on exit an
        # outer stage would come after the stages nested in it.
        probe = self.probe or _current.get() or _default
        if probe is not None:
            probe.see_stage(self.name)
        self._starts.append(perf_counter())
        return self

    def __exit__(self, *exc: object) -> Literal[False]:
        elapsed = perf_counter() - self._starts.pop()
        probe = self.probe or _current.get() or _default
        if probe is not None:
            probe.observe_stage(self.name, elapsed)
        return False

    async def __aenter__(self) -> stage:
        return self.__enter__()

    async def __aexit__(self, *exc: object) -> Literal[False]:
        return self.__exit__(*exc)

    def __call__(self, fn: F) -> F:
        # A fresh timer per call: concurrent calls of the decorated function must not share
        # one start stack.
        name, probe = self.name, self.probe
        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                with stage(name, probe):
                    return await fn(*args, **kwargs)

            return async_wrapper  # type: ignore[return-value]

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            with stage(name, probe):
                return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

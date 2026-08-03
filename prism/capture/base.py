"""Abstract base for capture backends."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable, List, Optional

from ..models import CapturedRequest, OverrideRule


CaptureCallback = Callable[[CapturedRequest], None]
"""Called when a request is captured. May be sync or async."""


class AbstractCaptureBackend(ABC):
    """Abstract interface for HTTP capture backends.

    Two implementations:
      - HiProfilerCaptureBackend: gRPC to hiprofilerd (no CA cert needed)
      - ProxyCaptureBackend: mitmproxy (supports real-time overrides)
    """

    @property
    @abstractmethod
    def backend_type(self) -> str:
        """Return backend identifier: "grpc" or "proxy"."""
        ...

    @property
    @abstractmethod
    def running(self) -> bool:
        """Whether the backend is actively capturing."""
        ...

    @property
    @abstractmethod
    def supports_overrides(self) -> bool:
        """Whether this backend supports real-time request/response overrides."""
        ...

    @abstractmethod
    async def start(self, on_request: CaptureCallback, **config) -> None:
        """Start capture.

        Args:
            on_request: Called with each CapturedRequest.
            **config: Backend-specific configuration.
        """
        ...

    @abstractmethod
    async def stop(self) -> None:
        """Stop capture and release resources."""
        ...

    async def set_overrides(self, rules: List[OverrideRule]) -> None:
        """Set override rules. Only meaningful for proxy backend."""
        pass

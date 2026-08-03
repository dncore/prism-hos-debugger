"""MITM proxy capture backend.

Wraps mitmproxy for HTTP/HTTPS interception. Supports real-time
request/response overrides. Requires CA certificate installation
on the device for HTTPS.

This is the fallback backend when hiprofilerd is unavailable,
or when real-time overrides are needed.
"""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from ..models import OverrideRule
from ..override_engine import OverrideEngine
from ..proxy_core import ProxyManager
from .base import AbstractCaptureBackend, CaptureCallback

logger = logging.getLogger(__name__)


class ProxyCaptureBackend(AbstractCaptureBackend):
    """Capture HTTP traffic via mitmproxy.

    Requires:
      - mitmproxy running on the host
      - Device configured to use the proxy (explicit proxy or transparent)
      - CA certificate installed on device for HTTPS

    Supports real-time overrides via the override engine.
    """

    BACKEND_TYPE = "proxy"

    def __init__(self):
        self._proxy = ProxyManager()
        self._engine = OverrideEngine()
        self._on_request: Optional[CaptureCallback] = None
        self._running = False

    @property
    def backend_type(self) -> str:
        return self.BACKEND_TYPE

    @property
    def running(self) -> bool:
        return self._proxy.running

    @property
    def supports_overrides(self) -> bool:
        return True

    @property
    def port(self) -> int:
        return self._proxy.port

    @property
    def ca_cert_path(self) -> str:
        return str(self._proxy.ca_cert_path)

    async def start(self, on_request: CaptureCallback, **config) -> None:
        """Start the proxy capture.

        Config keys:
          - port: Proxy listen port (default: 8080)
        """
        if self._running:
            raise RuntimeError("Proxy capture already running")

        self._on_request = on_request
        port = config.get("port", 8080)

        await self._proxy.start(port=port, on_request=on_request)
        self._running = True
        logger.info("Proxy capture started on port %d", port)

    async def stop(self) -> None:
        """Stop the proxy capture."""
        if self._proxy.running:
            await self._proxy.stop()
        self._running = False
        logger.info("Proxy capture stopped")

    async def set_overrides(self, rules: List[OverrideRule]) -> None:
        """Load override rules into the engine and attach to proxy."""
        self._engine.load_rules(rules)
        self._proxy.set_override_matcher(self._engine.create_matcher())
        logger.info("Loaded %d override rules", len([r for r in rules if r.enabled]))

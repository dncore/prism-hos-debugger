"""CaptureManager — unified entry point for HTTP capture.

Manages backend selection (gRPC vs proxy), lifecycle, and callback routing.
"""

from __future__ import annotations

import logging
from typing import List, Optional

from ..device_manager import DeviceManager
from ..models import CapturedRequest, OverrideRule
from .base import AbstractCaptureBackend, CaptureCallback
from .grpc_backend import HiProfilerCaptureBackend
from .proxy_backend import ProxyCaptureBackend

logger = logging.getLogger(__name__)


class CaptureManager:
    """Manages HTTP capture across dual backends.

    Usage:
        mgr = CaptureManager(device_manager)
        mgr.on_request = my_callback

        # gRPC mode (no CA cert)
        await mgr.start_grpc(pid=5231, device_id="ABC123")

        # Proxy mode (with overrides)
        await mgr.start_proxy(port=8080)
        await mgr.set_overrides(my_rules)

        # Stop
        await mgr.stop()
    """

    def __init__(self, device_manager: Optional[DeviceManager] = None):
        self._device_mgr = device_manager or DeviceManager()
        self._grpc_backend = HiProfilerCaptureBackend(self._device_mgr)
        self._proxy_backend = ProxyCaptureBackend()
        self._active_backend: Optional[AbstractCaptureBackend] = None
        self._on_request: Optional[CaptureCallback] = None

    @property
    def backend_type(self) -> Optional[str]:
        """Current active backend type, or None if not capturing."""
        if self._active_backend:
            return self._active_backend.backend_type
        return None

    @property
    def running(self) -> bool:
        return self._active_backend is not None and self._active_backend.running

    @property
    def supports_overrides(self) -> bool:
        return self._active_backend is not None and self._active_backend.supports_overrides

    @property
    def proxy_port(self) -> Optional[int]:
        if isinstance(self._active_backend, ProxyCaptureBackend):
            return self._active_backend.port
        return None

    @property
    def proxy_ca_path(self) -> Optional[str]:
        if isinstance(self._active_backend, ProxyCaptureBackend):
            return self._active_backend.ca_cert_path
        return None

    def set_callback(self, callback: CaptureCallback) -> None:
        """Set the global capture callback."""
        self._on_request = callback

    async def start_grpc(self, pid: int, device_id: Optional[str] = None,
                         host_port: int = 50051) -> None:
        """Start capture via hiprofilerd gRPC."""
        if self.running:
            raise RuntimeError("Capture already running")

        if not self._on_request:
            raise RuntimeError("No capture callback set. Call set_callback() first.")

        config = {"pid": pid, "host_port": host_port}
        if device_id:
            config["device_id"] = device_id

        await self._grpc_backend.start(self._on_request, **config)
        self._active_backend = self._grpc_backend
        logger.info("Capture started (gRPC mode, PID=%d)", pid)

    async def start_proxy(self, port: int = 8080) -> None:
        """Start capture via mitmproxy."""
        if self.running:
            raise RuntimeError("Capture already running")

        if not self._on_request:
            raise RuntimeError("No capture callback set. Call set_callback() first.")

        await self._proxy_backend.start(self._on_request, port=port)
        self._active_backend = self._proxy_backend
        logger.info("Capture started (proxy mode, port=%d)", port)

    async def stop(self) -> None:
        """Stop active capture backend."""
        if self._active_backend:
            await self._active_backend.stop()
            self._active_backend = None
            logger.info("Capture stopped")

    async def set_overrides(self, rules: List[OverrideRule]) -> bool:
        """Set override rules. Returns True if backend supports it."""
        if self._active_backend and self._active_backend.supports_overrides:
            await self._active_backend.set_overrides(rules)
            return True
        return False

    async def get_debuggable_apps(self) -> list[dict]:
        """Get list of debuggable processes from the selected device."""
        return await self._device_mgr.list_debuggable_apps()

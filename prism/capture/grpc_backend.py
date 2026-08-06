"""HiProfiler gRPC capture backend.

Communicates with the device-side hiprofilerd daemon via gRPC to capture
HTTP request/response data from target app processes.

This backend does NOT require CA certificate installation — it hooks into
the app process at the network layer before TLS encryption.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

from ..device_manager import DeviceManager
from ..hiprofiler_client import HiProfilerClient
from ..payload_parser import PayloadParser
from .base import AbstractCaptureBackend, CaptureCallback

logger = logging.getLogger(__name__)


class HiProfilerCaptureBackend(AbstractCaptureBackend):
    """Capture HTTP traffic via hiprofilerd gRPC on the device.

    Requires:
      - hiprofilerd running on device (auto-started via hiprofiler_cmd -s)
      - hdc fport forwarding host port → device 50051
      - Target app PID (from hdc jpid)

    Does NOT require CA certificate installation.
    Does NOT support real-time overrides (data is captured post-hoc).
    """

    BACKEND_TYPE = "grpc"

    def __init__(self, device_manager: Optional[DeviceManager] = None):
        self._device_mgr = device_manager or DeviceManager()
        self._client: Optional[HiProfilerClient] = None
        self._parser = PayloadParser()
        self._running = False
        self._session_id: Optional[int] = None
        self._host_port: int = 50051
        self._fetch_task: Optional[asyncio.Task] = None
        self._on_request: Optional[CaptureCallback] = None
        self._target_pid: Optional[int] = None

    @property
    def backend_type(self) -> str:
        return self.BACKEND_TYPE

    @property
    def running(self) -> bool:
        return self._running

    @property
    def supports_overrides(self) -> bool:
        return False  # Post-hoc capture, no real-time interception

    async def start(self, on_request: CaptureCallback, **config) -> None:
        """Start capture via hiprofilerd.

        Config keys:
          - pid: Target app process ID (required)
          - host_port: Host-side port for gRPC (default: 50051)
          - device_id: Target device ID (optional, uses selected device)
        """
        if self._running:
            raise RuntimeError("gRPC capture already running")

        self._on_request = on_request
        self._target_pid = config.get("pid")
        self._host_port = config.get("host_port", 50051)

        if not self._target_pid:
            raise ValueError("'pid' is required for gRPC capture")

        # Ensure device is selected
        device_id = config.get("device_id")
        if device_id and not self._device_mgr.selected_device_id:
            await self._device_mgr.select_device(device_id)

        if not self._device_mgr.selected_device_id:
            raise RuntimeError("No device selected")

        # Always reset profiler to clear stale session state before creating a new one.
        # Without this, re-selecting an app (or changing PIDs) leaves the device-side
        # hiprofilerd in a confused state where sessions are created but produce no data.
        if await self._device_mgr.is_profiler_running():
            logger.info("Resetting profiler to clear previous session state")
            await self._device_mgr.reset_profiler()
        else:
            ok = await self._device_mgr.start_profiler()
            if not ok or not await self._device_mgr.is_profiler_running():
                raise RuntimeError(
                    "hiprofilerd is not available on this device. "
                    "gRPC mode requires a physical HarmonyOS device with hiprofilerd. "
                    "Emulators and some devices do not include the profiler daemon. "
                    "Use proxy mode instead."
            )

        # Clean any stale forward on this port before setting up
        await self._device_mgr.remove_forward(f"tcp:{self._host_port}", "tcp:50051")
        # Setup port forwarding from host → device 50051
        logger.info("Setting up port forward %d → device:50051", self._host_port)
        ok = await self._device_mgr.setup_forward(self._host_port, 50051)
        if not ok:
            raise RuntimeError(f"Failed to forward port {self._host_port} to device:50051")

        # Connect gRPC
        self._client = HiProfilerClient()
        # Clear proxy env vars that interfere with gRPC
        for k in list(os.environ.keys()):
            if "proxy" in k.lower():
                del os.environ[k]

        await self._client.connect(host="127.0.0.1", port=self._host_port)

        # Create session with retry on stale state
        logger.info("Creating profiler session for PID=%d", self._target_pid)
        max_retries = 3
        for attempt in range(max_retries):
            try:
                self._session_id = await self._client.create_session(
                    ["network-profiler"],
                    pid=self._target_pid,
                )
                break
            except Exception as e:
                if attempt < max_retries - 1 and "create plugin sessions failed" in str(e):
                    logger.warning("Session creation failed (attempt %d/%d), resetting profiler...",
                                   attempt + 1, max_retries)
                    await self._device_mgr.reset_profiler()
                    await asyncio.sleep(1)
                    # Reconnect gRPC after reset
                    await self._client.disconnect()
                    await self._client.connect(host="127.0.0.1", port=self._host_port)
                else:
                    raise

        # Start session
        await self._client.start_session(self._session_id)
        logger.info("Profiler session %d started", self._session_id)

        # Begin background fetch
        self._running = True
        self._fetch_task = asyncio.create_task(self._fetch_loop())

    async def _fetch_loop(self) -> None:
        """Background task: stream captured data from hiprofilerd."""
        try:
            async for plugin_data in self._client.fetch_data(self._session_id):
                if not self._running:
                    break

                if plugin_data.name == "network-profiler" and plugin_data.data:
                    await self._process_data(plugin_data.data, plugin_data.tv_sec, plugin_data.tv_nsec)
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Error in fetch loop")

    async def _process_data(self, data: bytes, tv_sec: int, tv_nsec: int) -> None:
        """Process raw plugin data into CapturedRequest."""
        from network_profiler_event_pb2 import NetworkProfilerResult

        try:
            result = NetworkProfilerResult()
            result.ParseFromString(data)

            for event in result.network_event:
                proc_name = event.process_name.decode("utf-8", errors="replace") if event.process_name else ""
                thread_name = event.thread_name.decode("utf-8", errors="replace") if event.thread_name else ""

                capture = self._parser.parse_event(
                    payload=event.payload,
                    event_type=event.type,
                    tv_sec=event.tv_sec or tv_sec,
                    tv_nsec=event.tv_nsec or tv_nsec,
                    pid=event.pid,
                    tid=event.tid,
                    process_name=proc_name,
                    thread_name=thread_name,
                )

                if capture and self._on_request:
                    try:
                        result = self._on_request(capture)
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception:
                        logger.exception("Error in capture callback")
        except Exception:
            logger.debug("Failed to parse plugin data (%d bytes)", len(data))

    async def stop(self) -> None:
        """Stop capture and clean up."""
        self._running = False

        if self._fetch_task:
            self._fetch_task.cancel()
            try:
                await asyncio.wait_for(self._fetch_task, timeout=5.0)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                pass
            self._fetch_task = None

        if self._client and self._session_id is not None:
            try:
                await asyncio.wait_for(
                    self._client.stop_session(self._session_id), timeout=5.0
                )
                await asyncio.wait_for(
                    self._client.destroy_session(self._session_id), timeout=5.0
                )
            except (asyncio.TimeoutError, Exception):
                logger.warning("Timed out cleaning up profiler session %d — forcing cleanup",
                               self._session_id)
            self._session_id = None

        if self._client:
            try:
                await asyncio.wait_for(self._client.disconnect(), timeout=5.0)
            except (asyncio.TimeoutError, Exception):
                logger.warning("Timed out disconnecting gRPC client")
            self._client = None

        # Clean up port forward
        try:
            await self._device_mgr.remove_forward(f"tcp:{self._host_port}", "tcp:50051")
        except Exception:
            pass

        logger.info("gRPC capture stopped")

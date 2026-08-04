"""gRPC client for HarmonyOS hiprofilerd device-side profiler daemon.

Communicates with the hiprofilerd gRPC service running on port 50051
on the HarmonyOS device. Access is via hdc port forwarding.

Protocol reverse-engineered from DevEco Studio ohos-profiler plugin v26.0.0.461.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path
from typing import AsyncIterator, List, Optional

# Must be set before importing grpc to suppress fork() warning spam
# when subprocess (hdc commands) and gRPC threads coexist.
os.environ.setdefault("GRPC_ENABLE_FORK_SUPPORT", "1")

import grpc

# Add proto directory to path for generated stubs
_PROTO_DIR = Path(__file__).parent / "proto"
sys.path.insert(0, str(_PROTO_DIR))

from profiler_service_types_pb2 import (  # noqa: E402
    CreateSessionRequest,
    CreateSessionResponse,
    DestroySessionRequest,
    FetchDataRequest,
    FetchDataResponse,
    GetCapabilitiesRequest,
    GetCapabilitiesResponse,
    ProfilerSessionConfig,
    StartSessionRequest,
    StopSessionRequest,
)
from profiler_service_pb2_grpc import IProfilerServiceStub  # noqa: E402
from common_types_pb2 import (  # noqa: E402
    ProfilerPluginConfig,
    ProfilerPluginData,
)
from network_profiler_config_pb2 import NetworkProfilerConfig  # noqa: E402

logger = logging.getLogger(__name__)


class HiProfilerClient:
    """Async gRPC client for the hiprofilerd device profiler daemon.

    Usage:
        client = HiProfilerClient()
        await client.connect(host="127.0.0.1", port=50051)
        caps = await client.get_capabilities()
        session_id = await client.create_session(["network-profiler"], pid=12345)
        await client.start_session(session_id)
        async for data in client.fetch_data(session_id):
            # process captured data
        await client.stop_session(session_id)
        await client.destroy_session(session_id)
    """

    def __init__(self):
        self._channel: Optional[grpc.aio.Channel] = None
        self._stub: Optional[IProfilerServiceStub] = None
        self._request_id: int = 0
        self._session_ids: List[int] = []  # Track created sessions for cleanup

    @property
    def connected(self) -> bool:
        return self._channel is not None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.cleanup_all()
        await self.disconnect()

    async def connect(self, host: str = "127.0.0.1", port: int = 50051) -> None:
        """Connect to the hiprofilerd gRPC server."""
        self._channel = grpc.aio.insecure_channel(f"{host}:{port}")
        self._stub = IProfilerServiceStub(self._channel)
        logger.info("Connected to hiprofilerd at %s:%d", host, port)

    async def disconnect(self) -> None:
        """Close the gRPC connection."""
        if self._channel:
            await self._channel.close()
            self._channel = None
            self._stub = None

    async def cleanup_all(self) -> None:
        """Destroy all tracked sessions. Safe to call even if partially initialized."""
        for sid in list(self._session_ids):
            try:
                await self.destroy_session(sid)
            except Exception:
                logger.debug("Failed to destroy session %d during cleanup", sid)
        self._session_ids.clear()

    def _next_request_id(self) -> int:
        self._request_id += 1
        return self._request_id

    # ── Service API ─────────────────────────────────────────────

    async def get_capabilities(self) -> dict:
        """Get the list of available profiler plugins and their capabilities.

        Equivalent to `hiprofiler_cmd -l` on device.
        """
        if not self._stub:
            raise RuntimeError("Not connected")

        req = GetCapabilitiesRequest(request_id=self._next_request_id())
        resp: GetCapabilitiesResponse = await self._stub.GetCapabilities(req)

        plugins = []
        for cap in resp.capabilities:
            plugins.append({"name": cap.name, "path": cap.path})

        return {"status": resp.status, "capabilities": plugins}

    async def create_session(
        self,
        plugin_names: List[str],
        pid: Optional[int] = None,
        sample_interval: int = 1000,
    ) -> int:
        """Create a profiling session with the specified plugins.

        Args:
            plugin_names: List of plugin names (e.g., ["network-profiler"])
            pid: Target process PID for per-process profiling
            sample_interval: Polling interval in ms

        Returns:
            session_id: The created session ID
        """
        if not self._stub:
            raise RuntimeError("Not connected")

        # Build plugin configs
        plugin_configs = []
        for name in plugin_names:
            config_data = b""
            if name == "network-profiler" and pid is not None:
                net_config = NetworkProfilerConfig(
                    pid=[pid],
                    clock_id=NetworkProfilerConfig.BOOTTIME,
                    smb_pages=256,
                    flush_interval=1000,
                    block=False,
                )
                config_data = net_config.SerializeToString()

            plugin_configs.append(ProfilerPluginConfig(
                name=name,
                plugin_sha256="",  # builtin plugins don't need SHA
                sample_interval=sample_interval,
                config_data=config_data,
                is_protobuf_serialize=True,
            ))

        session_config = ProfilerSessionConfig(
            buffers=[ProfilerSessionConfig.BufferConfig(pages=256, policy=ProfilerSessionConfig.BufferConfig.RECYCLE)],
            session_mode=ProfilerSessionConfig.ONLINE,
            keep_alive_time=0,
            discard_cache_data=True,
        )

        req = CreateSessionRequest(
            request_id=self._next_request_id(),
            session_config=session_config,
            plugin_configs=plugin_configs,
        )
        resp: CreateSessionResponse = await self._stub.CreateSession(req)

        if resp.status != 0:
            raise RuntimeError(f"CreateSession failed: status={resp.status}")

        logger.info("Created session %d with plugins: %s", resp.session_id, plugin_names)
        self._session_ids.append(resp.session_id)
        return resp.session_id

    async def start_session(self, session_id: int) -> None:
        """Start data collection for a session."""
        if not self._stub:
            raise RuntimeError("Not connected")

        req = StartSessionRequest(
            request_id=self._next_request_id(),
            session_id=session_id,
        )
        resp = await self._stub.StartSession(req)
        if resp.status != 0:
            raise RuntimeError(f"StartSession failed with status {resp.status}")
        logger.info("Started session %d", session_id)

    async def fetch_data(self, session_id: int) -> AsyncIterator[ProfilerPluginData]:
        """Stream captured data from a running session.

        Yields ProfilerPluginData objects containing the captured HTTP traffic.
        """
        if not self._stub:
            raise RuntimeError("Not connected")

        req = FetchDataRequest(
            request_id=self._next_request_id(),
            session_id=session_id,
        )
        call = self._stub.FetchData(req)

        async for resp in call:
            if resp.status != 0:
                logger.warning("FetchData response status: %d", resp.status)
                continue

            for plugin_data in resp.plugin_data:
                yield plugin_data

            if not resp.has_more:
                break

    async def stop_session(self, session_id: int) -> None:
        """Stop data collection for a session."""
        if not self._stub:
            raise RuntimeError("Not connected")

        req = StopSessionRequest(
            request_id=self._next_request_id(),
            session_id=session_id,
        )
        resp = await self._stub.StopSession(req)
        if resp.status != 0:
            raise RuntimeError(f"StopSession failed with status {resp.status}")
        logger.info("Stopped session %d", session_id)

    async def destroy_session(self, session_id: int) -> None:
        """Destroy a session and release resources."""
        if not self._stub:
            raise RuntimeError("Not connected")

        req = DestroySessionRequest(
            request_id=self._next_request_id(),
            session_id=session_id,
        )
        resp = await self._stub.DestroySession(req)
        if resp.status != 0:
            raise RuntimeError(f"DestroySession failed with status {resp.status}")
        if session_id in self._session_ids:
            self._session_ids.remove(session_id)
        logger.info("Destroyed session %d", session_id)

"""Device manager — wraps the official hdc CLI for HarmonyOS device interaction.

All hdc commands are verified against the official OpenHarmony documentation:
  subsys-toolchain-hdc-guide.md

This module does NOT implement any device protocol — it shells out to the
official hdc binary exclusively.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
from dataclasses import dataclass, field
from typing import List, Optional

from .models import Device, DeviceStatus

logger = logging.getLogger(__name__)


@dataclass
class PortForward:
    """Record of an active port forwarding task."""
    local: str   # e.g. "tcp:8080"
    remote: str  # e.g. "tcp:8080"
    direction: str  # "forward" (fport) or "reverse" (rport)


@dataclass
class DeviceManager:
    """Manages a single HarmonyOS device session.

    Uses the official hdc binary. Expects `hdc` to be on PATH or
    configured via HDC_BIN environment variable.
    """

    hdc_bin: str = field(default_factory=lambda: "hdc")
    selected_device_id: Optional[str] = None
    _forwards: List[PortForward] = field(default_factory=list)

    # ── binary discovery ───────────────────────────────────────────

    def __post_init__(self) -> None:
        # Allow override via env var
        env_bin = os.environ.get("HDC_BIN", "")
        if env_bin:
            self.hdc_bin = env_bin
            return
        # If hdc is already on PATH, use it as-is
        if shutil.which(self.hdc_bin):
            return
        # Otherwise try common DevEco Studio install locations
        common_paths = [
            "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc",
            os.path.expanduser("~/Library/Huawei/Sdk/harmonyos/toolchains/hdc"),
            os.path.expanduser("~/huawei/sdk/default/openharmony/toolchains/hdc"),
            os.path.expanduser("~/DevEcoStudio/sdk/default/openharmony/toolchains/hdc"),
        ]
        for p in common_paths:
            if os.path.isfile(p) and os.access(p, os.X_OK):
                self.hdc_bin = p
                return

    @property
    def available(self) -> bool:
        """Whether hdc binary is available."""
        return shutil.which(self.hdc_bin) is not None or os.path.isfile(self.hdc_bin)

    # ── command runner ─────────────────────────────────────────────

    async def _run(self, *args: str, timeout: float = 15.0) -> asyncio.subprocess.Process:
        """Run an hdc command. Returns the completed process."""
        cmd = [self.hdc_bin, *args]
        logger.debug("hdc: %s", " ".join(cmd))

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError(f"hdc command timed out after {timeout}s: {' '.join(cmd)}")
        return proc

    async def _run_with_device(self, *args: str, timeout: float = 15.0) -> asyncio.subprocess.Process:
        """Run an hdc command targeting the selected device."""
        if self.selected_device_id:
            return await self._run("-t", self.selected_device_id, *args, timeout=timeout)
        return await self._run(*args, timeout=timeout)

    def _hdc_args(self, *args: str) -> list:
        """Build argument list with optional -t prefix for selected device."""
        cmd = [self.hdc_bin]
        if self.selected_device_id:
            cmd.extend(["-t", self.selected_device_id])
        cmd.extend(args)
        return cmd

    # ── device listing ─────────────────────────────────────────────

    async def list_devices(self) -> List[Device]:
        """List all connected HarmonyOS devices.

        Runs `hdc list targets -v` and parses the output.
        Reference: hdc list targets[-v] — "显示所有已经连接的目标设备列表"
        """
        proc = await self._run("list", "targets", "-v")
        stdout = (await proc.stdout.read()).decode("utf-8", errors="replace").strip()
        stderr = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            logger.error("hdc list targets failed: %s", stderr)
            return []

        if not stdout or stdout == "[Empty]":
            return []

        devices = self._parse_device_list(stdout)
        await self._enrich_device_models(devices)
        return devices

    def _parse_device_list(self, output: str) -> List[Device]:
        """Parse the output of 'hdc list targets -v'.

        The exact output format varies by hdc version. Common patterns:
        - "device_id" (simple, one per line)
        - "device_id    transport    status" (tab/space separated, with -v)
        """
        devices: List[Device] = []
        lines = output.strip().split("\n")

        for line in lines:
            line = line.strip()
            if not line:
                continue

            parts = re.split(r"\s+", line)
            device_id = parts[0] if parts else ""
            if not device_id:
                continue

            device = Device(device_id=device_id)

            # Try to parse additional -v fields
            for part in parts[1:]:
                part_lower = part.lower()
                if part_lower in ("device", "online"):
                    device.status = DeviceStatus.ONLINE
                elif part_lower == "offline":
                    device.status = DeviceStatus.OFFLINE
                elif part_lower == "unauthorized":
                    device.status = DeviceStatus.UNAUTHORIZED
                elif ":" in part and not part.startswith("tcp:"):
                    device.transport = "tcp"
                    device.name = part

            # Detect transport from device ID
            if ":" in device_id and not device_id.startswith("tcp:"):
                device.transport = "tcp"

            devices.append(device)

        return devices

    async def _fetch_device_model(self, device_id: str) -> str:
        """Fetch the device model name via hdc shell param get. Returns empty string on failure."""
        try:
            proc = await self._run("-t", device_id, "shell", "param get const.product.model", timeout=5)
            stdout = (await proc.stdout.read()).decode("utf-8", errors="replace").strip()
            if proc.returncode == 0 and stdout and not stdout.startswith("Fail"):
                return stdout
        except Exception:
            pass
        return ""

    async def _enrich_device_models(self, devices: List[Device]) -> None:
        """Fetch model names for all online devices in parallel."""
        tasks = []
        for d in devices:
            if d.status == DeviceStatus.ONLINE:
                tasks.append((d, self._fetch_device_model(d.device_id)))
        if not tasks:
            return
        results = await asyncio.gather(*[t[1] for t in tasks], return_exceptions=True)
        for (device, _), model in zip(tasks, results):
            if isinstance(model, str) and model:
                device.model = model

    # ── device selection ───────────────────────────────────────────

    async def select_device(self, device_id: str) -> bool:
        """Select a device for subsequent operations."""
        devices = await self.list_devices()
        matching = [d for d in devices if d.device_id == device_id]
        if not matching:
            logger.warning("Device %s not found in connected devices", device_id)
            return False
        self.selected_device_id = device_id
        return True

    async def get_device_info(self) -> Optional[Device]:
        """Get info for the selected device."""
        if not self.selected_device_id:
            return None
        devices = await self.list_devices()
        for d in devices:
            if d.device_id == self.selected_device_id:
                return d
        return None

    # ── port forwarding ────────────────────────────────────────────

    async def setup_reverse_forward(self, device_port: int, host_port: int) -> bool:
        """Set up reverse port forwarding: device → host.

        Uses `hdc rport tcp:<device_port> tcp:<host_port>`
        """
        remote = f"tcp:{device_port}"
        local = f"tcp:{host_port}"

        proc = await self._run_with_device("rport", remote, local)
        stdout = (await proc.stdout.read()).decode("utf-8", errors="replace").strip()
        stderr = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()

        # hdc reports success as "Forwardport result:OK" on stdout, failure as "[Fail]..." on stdout
        if "OK" not in stdout or "Fail" in stdout:
            logger.error("Failed to set up rport %s -> %s: stdout=%s stderr=%s", remote, local, stdout, stderr)
            return False

        self._forwards.append(PortForward(local=local, remote=remote, direction="reverse"))
        logger.info("Reverse forward: device %s -> host %s", remote, local)
        return True

    async def setup_forward(self, host_port: int, device_port: int) -> bool:
        """Set up forward port forwarding: host → device.

        Uses `hdc fport tcp:<host_port> tcp:<device_port>`
        """
        local = f"tcp:{host_port}"
        remote = f"tcp:{device_port}"

        proc = await self._run_with_device("fport", local, remote)
        stdout = (await proc.stdout.read()).decode("utf-8", errors="replace").strip()
        stderr = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()

        # hdc reports success as "Forwardport result:OK" on stdout, failure as "[Fail]..." on stdout
        if "OK" not in stdout or "Fail" in stdout:
            logger.error("Failed to set up fport %s -> %s: stdout=%s stderr=%s", local, remote, stdout, stderr)
            return False

        self._forwards.append(PortForward(local=local, remote=remote, direction="forward"))
        logger.info("Forward: host %s -> device %s", local, remote)
        return True

    async def list_forwards(self) -> List[PortForward]:
        """List all active forwarding tasks. Uses `hdc fport ls`."""
        proc = await self._run_with_device("fport", "ls")
        stdout = (await proc.stdout.read()).decode("utf-8", errors="replace").strip()
        if not stdout or stdout == "[Empty]":
            return self._forwards

        forwards: List[PortForward] = []
        for line in stdout.split("\n"):
            line = line.strip()
            if not line:
                continue
            # Format: "device_id    tcp:local tcp:remote    [Direction]"
            # Also handles: "[Forward] tcp:local tcp:remote" (older hdc versions)
            match = re.search(
                r"(tcp:\d+)\s+(tcp:\d+)\s+\[(Forward|Reverse)\]",
                line,
            )
            if match:
                local, remote, dir_str = match.groups()
                direction = "forward" if dir_str == "Forward" else "reverse"
                # In fport ls output:
                # [Forward] = fport: port1=host(local) port2=device(remote)
                # [Reverse] = rport: port1=device(remote) port2=host(local)
                if direction == "reverse":
                    local, remote = remote, local
                forwards.append(PortForward(
                    local=local, remote=remote, direction=direction,
                ))
        self._forwards = forwards
        return forwards

    async def remove_forward(self, local: str, remote: str) -> bool:
        """Remove a specific forwarding task. Uses `hdc fport rm`."""
        proc = await self._run_with_device("fport", "rm", local, remote)
        stderr = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()
        if proc.returncode != 0 and stderr:
            logger.error("Failed to remove forward %s %s: %s", local, remote, stderr)
            return False
        self._forwards = [f for f in self._forwards if not (f.local == local and f.remote == remote)]
        return True

    async def teardown_all_forwards(self) -> None:
        """Remove all port forwarding tasks for the selected device."""
        forwards = await self.list_forwards()
        for fwd in forwards:
            await self.remove_forward(fwd.local, fwd.remote)
        self._forwards.clear()

    # ── shell & utility ────────────────────────────────────────────

    async def shell(self, command: str, timeout: float = 15.0) -> tuple:
        """Run a shell command on the selected device. Returns (returncode, stdout, stderr)."""
        proc = await self._run_with_device("shell", command, timeout=timeout)
        stdout = (await proc.stdout.read()).decode("utf-8", errors="replace").strip()
        stderr = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()
        return proc.returncode, stdout, stderr

    async def set_global_proxy(self, host: str, port: int) -> bool:
        """Attempt to set the global HTTP proxy on the device.

        Command: settings put global http_proxy <host>:<port>
        Note: May not work on HarmonyOS NEXT.
        """
        returncode, stdout, stderr = await self.shell(
            f"settings put global http_proxy {host}:{port}"
        )
        if returncode != 0:
            logger.warning("Failed to set global proxy (expected on HarmonyOS NEXT): %s", stderr)
            return False
        return True

    async def clear_global_proxy(self) -> bool:
        """Clear the global HTTP proxy on the device."""
        returncode, stdout, stderr = await self.shell("settings put global http_proxy :0")
        if returncode != 0:
            logger.warning("Failed to clear global proxy: %s", stderr)
            return False
        return True

    async def list_debuggable_processes(self) -> List[str]:
        """List debuggable processes on the device. Uses `hdc jpid`."""
        proc = await self._run_with_device("jpid")
        stdout = (await proc.stdout.read()).decode("utf-8", errors="replace").strip()
        if not stdout:
            return []
        return [line.strip() for line in stdout.split("\n") if line.strip()]

    # ── hiprofilerd lifecycle ────────────────────────────────────

    async def is_profiler_running(self) -> bool:
        """Check if hiprofilerd is running on the device."""
        rc, stdout, _ = await self.shell("pidof hiprofilerd")
        return rc == 0 and stdout.strip() != ""

    async def start_profiler(self) -> bool:
        """Start the hiprofilerd daemon on the device.

        Uses `hiprofiler_cmd -s`.
        Returns True if started or already running.
        """
        if await self.is_profiler_running():
            logger.info("hiprofilerd already running")
            return True

        rc, stdout, stderr = await self.shell("hiprofiler_cmd -s")
        if rc != 0:
            logger.error("Failed to start hiprofilerd: %s", stderr or stdout)
            return False

        # Wait for daemon to bind port 50051
        import asyncio as _asyncio
        for _ in range(5):
            await _asyncio.sleep(0.3)
            if await self.is_profiler_running():
                logger.info("hiprofilerd started")
                return True

        logger.warning("hiprofilerd may not have started")
        return False

    async def stop_profiler(self) -> bool:
        """Stop the hiprofilerd daemon on the device.

        Uses `hiprofiler_cmd -k`.
        """
        rc, stdout, stderr = await self.shell("hiprofiler_cmd -k")
        if rc != 0:
            logger.error("Failed to stop hiprofilerd: %s", stderr or stdout)
            return False
        logger.info("hiprofilerd stopped")
        return True

    async def reset_profiler(self) -> bool:
        """Force-restart hiprofilerd to clear stale session state.

        Kills all hiprofilerd processes (including hung ones), then starts fresh.
        Use this when CreateSession returns 'create plugin sessions failed!'.
        """
        logger.info("Force-resetting hiprofilerd...")
        # Kill all instances (hiprofiler_cmd -k may not catch everything)
        await self.shell("hiprofiler_cmd -k")
        await self.shell("killall hiprofilerd 2>/dev/null || true")
        import asyncio as _asyncio
        await _asyncio.sleep(1)
        # Start fresh
        return await self.start_profiler()

    async def get_profiler_port(self) -> int:
        """Get the hiprofilerd gRPC port. Returns 50051 (default)."""
        rc, stdout, _ = await self.shell("hiprofiler_cmd -q")
        if rc == 0 and "port:" in stdout:
            for line in stdout.split("\n"):
                if line.startswith("port:"):
                    try:
                        return int(line.split(":")[1].strip())
                    except (ValueError, IndexError):
                        pass
        return 50051  # Default

    async def list_debuggable_apps(self) -> list[dict]:
        """Get list of debuggable processes with PID, full package name, and short display name.

        Uses a single `ps -A` call instead of N+1 `ps -p <pid>` calls.
        """
        debuggable_pids = set(await self.list_debuggable_processes())

        # Single batch call: ps -A -o pid=,args= dumps all PIDs with full command lines
        rc, stdout, _ = await self.shell("ps -A -o pid=,args=")
        if rc != 0 or not stdout.strip():
            return []

        apps = []
        for line in stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) < 2 or parts[0] not in debuggable_pids:
                continue
            pid = int(parts[0])
            full_name = parts[1]
            short = full_name.split(".")[-1] if "." in full_name else full_name
            apps.append({
                "pid": pid,
                "name": full_name,
                "short_name": short,
            })

        return sorted(apps, key=lambda a: a["name"].lower())

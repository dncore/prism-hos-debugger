"""HTTP/HTTPS proxy core using mitmproxy.

Captures all HTTP request/response data including headers, bodies, and
detailed timing information. Integrates with the override engine for
request/response modification.

HTTPS interception works via dynamically generated CA certificates.
The device must trust the generated CA certificate for HTTPS to work.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional

from mitmproxy import options
from mitmproxy.http import HTTPFlow, Response
from mitmproxy.tools.dump import DumpMaster

from .models import CapturedRequest, HttpMethod

logger = logging.getLogger(__name__)

# ── Data directory ──────────────────────────────────────────────────

def _data_dir() -> Path:
    """Get the prism data directory for certs, config, and DB."""
    path = Path.home() / ".prism-hos-debugger"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _cert_dir() -> Path:
    d = _data_dir() / "certs"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ── Callback protocol ───────────────────────────────────────────────

RequestCallback = Callable[[CapturedRequest], None]
"""Called when a request flow is complete with full captured data."""


# ── Mitmproxy Addon ─────────────────────────────────────────────────

class HaruCaptureAddon:
    """Mitmproxy addon that captures HTTP flows into CapturedRequest models."""

    def __init__(
        self,
        on_request_complete: Optional[RequestCallback] = None,
        override_matcher: Optional[Callable[[HTTPFlow], Optional[dict]]] = None,
    ):
        self.on_request_complete = on_request_complete
        self.override_matcher = override_matcher
        # Track request timing: flow_id -> start_time
        self._start_times: dict[str, float] = {}

    def request(self, flow: HTTPFlow) -> None:
        """Intercept request before it's sent to the server."""
        self._start_times[flow.id] = time.monotonic()

        # Apply override rules if a matcher is provided
        if self.override_matcher:
            result = self.override_matcher(flow)
            if result:
                override_type = result.get("type", "")
                if override_type == "block":
                    flow.response = Response.make(
                        503,
                        b"Blocked by prism override",
                        {"Content-Type": "text/plain"},
                    )
                elif override_type == "url_redirect" and result.get("redirect_url"):
                    flow.request.url = result["redirect_url"]
                elif override_type == "header_modify":
                    for k, v in result.get("add_headers", {}).items():
                        flow.request.headers[k] = v
                    for k in result.get("remove_headers", []):
                        flow.request.headers.pop(k, None)
                elif override_type == "latency":
                    # Handled in response() due to mitmproxy API design
                    pass

    def response(self, flow: HTTPFlow) -> None:
        """Capture the full request/response after it completes."""
        start = self._start_times.pop(flow.id, None)
        end = time.monotonic()
        total_ms = (end - start) * 1000 if start else 0.0

        # Apply response overrides
        override_rule_id = None
        intercepted = False
        if self.override_matcher:
            result = self.override_matcher(flow)
            if result:
                intercepted = True
                override_rule_id = result.get("rule_id")
                override_type = result.get("type", "")

                if override_type == "response_status" and result.get("status"):
                    flow.response.status_code = result["status"]
                elif override_type == "response_body" and result.get("body") is not None:
                    flow.response.content = result["body"].encode("utf-8") if isinstance(result["body"], str) else result["body"]
                    flow.response.headers["content-length"] = str(len(flow.response.content))
                elif override_type == "response_headers":
                    for k, v in result.get("add_headers", {}).items():
                        flow.response.headers[k] = v
                    for k in result.get("remove_headers", []):
                        flow.response.headers.pop(k, None)
                elif override_type == "latency" and result.get("latency_ms"):
                    # Latency is simulated — mark as intercepted
                    pass

        # Extract body content (truncate large bodies for display)
        request_body = self._extract_body(flow.request.content, flow.request.headers.get("content-type", ""))
        response_body = self._extract_body(flow.response.content, flow.response.headers.get("content-type", ""))

        capture = CapturedRequest(
            id=str(uuid.uuid4()),
            url=flow.request.pretty_url,
            method=HttpMethod(flow.request.method),
            scheme=flow.request.scheme,
            request_headers=dict(flow.request.headers),
            request_body=request_body,
            request_body_size=len(flow.request.content) if flow.request.content else 0,
            response_status=flow.response.status_code,
            response_headers=dict(flow.response.headers),
            response_body=response_body,
            response_body_size=len(flow.response.content) if flow.response.content else 0,
            timestamp=datetime.now(),
            ttfb_ms=total_ms,
            total_duration_ms=total_ms,
            is_https=flow.request.scheme == "https",
            intercepted=intercepted,
            rule_id=override_rule_id,
            remote_address=f"{flow.server_conn.address[0]}:{flow.server_conn.address[1]}" if flow.server_conn and flow.server_conn.address else "",
            content_type=flow.response.headers.get("content-type", ""),
        )

        if self.on_request_complete:
            try:
                result = self.on_request_complete(capture)
                # Handle both sync and async callbacks
                if asyncio.iscoroutine(result):
                    # We're in mitmproxy's sync context, schedule on the event loop
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(result)
                    except RuntimeError:
                        # No running loop — run synchronously in a new loop
                        asyncio.run(result)
            except Exception:
                logger.exception("Error in request callback")

    def _extract_body(self, content: bytes, content_type: str) -> Optional[str]:
        """Extract and decode body content. Truncate binary/large data."""
        if not content:
            return None

        # Text-based content types
        text_types = (
            "application/json",
            "application/xml",
            "text/",
            "application/x-www-form-urlencoded",
            "application/javascript",
            "application/ld+json",
        )

        is_text = any(content_type.startswith(t) for t in text_types)

        if not is_text:
            # Try UTF-8 decode, fall back to hex preview
            try:
                text = content.decode("utf-8", errors="strict")
                # If more than 80% printable, treat as text
                printable = sum(1 for c in text if c.isprintable() or c in "\n\r\t")
                if len(text) > 0 and printable / len(text) > 0.8:
                    return text[:100_000]  # 100KB cap
            except UnicodeDecodeError:
                pass
            return f"<binary: {len(content)} bytes>"

        try:
            text = content.decode("utf-8", errors="replace")
            # Pretty-print JSON if possible
            if "json" in content_type:
                try:
                    parsed = json.loads(text)
                    return json.dumps(parsed, indent=2, ensure_ascii=False)[:100_000]
                except (json.JSONDecodeError, ValueError):
                    pass
            return text[:100_000]
        except Exception:
            return f"<decode error: {len(content)} bytes>"


# ── Proxy Manager ───────────────────────────────────────────────────

class ProxyManager:
    """Manages the mitmproxy lifecycle.

    DumpMaster.run() is an async coroutine that runs its own event loop until shutdown().
    We run it in a dedicated thread so it doesn't block the main asyncio event loop
    (e.g., FastAPI server).

    Usage:
        mgr = ProxyManager()
        await mgr.start(port=8080, on_request=my_handler)
        # ... proxy is running ...
        await mgr.stop()
    """

    def __init__(self):
        self._master: Optional[DumpMaster] = None
        self._addon: Optional[HaruCaptureAddon] = None
        self._running: bool = False
        self._port: int = 8080
        self._on_request: Optional[RequestCallback] = None
        self._override_match_fn: Optional[Callable[[HTTPFlow], Optional[dict]]] = None
        self._thread: Optional[threading.Thread] = None

    @property
    def port(self) -> int:
        return self._port

    @property
    def running(self) -> bool:
        return self._running

    @property
    def ca_cert_path(self) -> Path:
        """Path to the generated CA certificate for device installation."""
        return _cert_dir() / "mitmproxy-ca-cert.pem"

    def set_override_matcher(self, matcher: Optional[Callable[[HTTPFlow], Optional[dict]]]) -> None:
        """Set the override rule matching function."""
        self._override_match_fn = matcher

    def _run_in_thread(self, master: DumpMaster) -> None:
        """Run the master's async run() in a dedicated event loop (called from thread)."""
        try:
            asyncio.run(master.run())
        except Exception:
            logger.exception("Error in proxy thread")

    async def start(
        self,
        port: int = 8080,
        on_request: Optional[RequestCallback] = None,
    ) -> None:
        """Start the proxy server.

        Args:
            port: Port to listen on.
            on_request: Callback called with every captured CapturedRequest.
        """
        if self._running:
            raise RuntimeError("Proxy is already running")

        self._port = port
        self._on_request = on_request

        # mitmproxy v11: DumpMaster.run() is an async coroutine.
        # We run it in a dedicated thread with asyncio.run().
        opts = options.Options(
            listen_port=port,
            confdir=str(_data_dir()),
        )

        self._master = DumpMaster(opts)

        self._addon = HaruCaptureAddon(
            on_request_complete=self._on_capture_complete,
            override_matcher=self._override_match_fn,
        )
        self._master.addons.add(self._addon)

        self._thread = threading.Thread(
            target=self._run_in_thread,
            args=(self._master,),
            daemon=True,
            name="prism-proxy",
        )
        self._thread.start()
        self._running = True

        # Wait briefly for the proxy to start listening
        await asyncio.sleep(0.5)
        logger.info("Proxy started on port %d", port)

    async def _on_capture_complete(self, capture: CapturedRequest) -> None:
        """Internal handler — forwards to user callback."""
        if self._on_request:
            try:
                # Callback may be sync or async — schedule safely
                result = self._on_request(capture)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("Error in request callback")

    async def stop(self) -> None:
        """Stop the proxy server."""
        if not self._running:
            return

        logger.info("Stopping proxy...")
        self._running = False

        if self._master:
            self._master.shutdown()

        if self._thread and self._thread.is_alive():
            # Wait for the thread to finish (run_until_complete will return after shutdown)
            await asyncio.to_thread(self._thread.join, timeout=5.0)

        self._thread = None
        self._master = None
        self._addon = None
        logger.info("Proxy stopped")

    def generate_ca_cert(self) -> Path:
        """Ensure CA certificate exists and return its path.

        Mitmproxy generates CA certs automatically on first HTTPS interception.
        This method checks common locations and returns the first found cert,
        or raises an error if none exists yet (user should browse an HTTPS site first).
        """
        cert_dir = _cert_dir()

        # mitmproxy v11 stores certs in the confdir
        possible_paths = [
            cert_dir / "mitmproxy-ca-cert.pem",
            cert_dir / "mitmproxy-ca.pem",
            Path.home() / ".mitmproxy" / "mitmproxy-ca-cert.pem",
            Path.home() / ".mitmproxy" / "mitmproxy-ca.p12",
        ]

        for p in possible_paths:
            if p.exists():
                return p

        # Trigger cert generation by making mitmproxy create them
        logger.info("CA cert not found — it will be generated on first HTTPS connection")
        return cert_dir / "mitmproxy-ca-cert.pem"

    async def get_request_count(self) -> int:
        """Get the total request count since proxy start."""
        from .db import count_requests
        return await count_requests()

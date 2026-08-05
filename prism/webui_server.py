"""FastAPI server providing REST API and Web UI for PRISM HTTP debugger.

Serves:
  - REST API for devices, requests, rules, proxy control
  - SSE endpoint for live request streaming
  - Static files (the Web UI frontend)
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from .db import (
    clear_requests,
    count_requests,
    create_rule,
    delete_rule,
    get_enabled_rules,
    get_request,
    init_db,
    insert_request,
    list_requests,
    list_rules,
    toggle_rule,
    update_rule,
)
from .device_manager import DeviceManager
from .models import (
    CapturedRequest,
    Device,
    HttpMethod,
    MatchType,
    OverrideRule,
    OverrideType,
    ProxyStartRequest,
    ProxyState,
    ProxyStatus,
)
from .override_engine import OverrideEngine
from .proxy_core import ProxyManager

logger = logging.getLogger(__name__)

# ── App Setup ───────────────────────────────────────────────────────

app = FastAPI(
    title="prism — HarmonyOS HTTP Debugger",
    version="0.1.0",
    description="Chrome DevTools-style HTTP debugging proxy for HarmonyOS devices",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .capture.manager import CaptureManager  # noqa: E402

# ── Global State ────────────────────────────────────────────────────

device_mgr = DeviceManager()
proxy_mgr = ProxyManager()
override_engine = OverrideEngine()
capture_mgr = CaptureManager(device_manager=device_mgr)

# SSE subscribers: set of asyncio.Queue for live request streaming
_sse_queues: set[asyncio.Queue] = set()

# ── Request Captures ────────────────────────────────────────────────

async def on_request_captured(capture: CapturedRequest) -> None:
    """Callback when proxy captures a request. Persists to DB and broadcasts via SSE."""
    try:
        await insert_request(capture)
    except Exception:
        logger.exception("Failed to persist request")

    # Broadcast to SSE subscribers
    data = capture.model_dump(mode="json")
    for q in _sse_queues:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            pass


# ── Startup / Shutdown ──────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    data_dir = Path.home() / ".prism-hos-debugger"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = str(data_dir / "prism.db")
    await init_db(db_path)

@app.on_event("shutdown")
async def shutdown():
    if capture_mgr.running:
        await capture_mgr.stop()
    if proxy_mgr.running:
        await proxy_mgr.stop()
    await device_mgr.teardown_all_forwards()
    # Close SSE queues
    for q in _sse_queues:
        await q.put(None)  # Sentinel to close


# ── Devices ─────────────────────────────────────────────────────────

@app.get("/api/devices", response_model=List[Device])
async def api_list_devices():
    """List all connected HarmonyOS devices."""
    return await device_mgr.list_devices()


@app.get("/api/devices/current", response_model=Optional[Device])
async def api_get_current_device():
    """Get the currently selected device."""
    if device_mgr.selected_device_id:
        return await device_mgr.get_device_info()
    return None


@app.post("/api/devices/select")
async def api_select_device(req: ProxyStartRequest):
    """Select a device. No port-forwarding side effects — capture backends
    manage their own forwards. Returns 404 if the device isn't connected."""
    if not await device_mgr.select_device(req.device_id):
        raise HTTPException(status_code=404, detail="Device not found")

    device_info = await device_mgr.get_device_info()
    online = device_info is not None and device_info.status.value == "online"
    return {
        "success": True,
        "online": online,
        "device": device_info.model_dump() if device_info else None,
        "message": "Device selected" if online else "Device selected but is offline — capture apps may be empty",
    }


# ── Proxy Control ───────────────────────────────────────────────────

@app.get("/api/proxy/status", response_model=ProxyStatus)
async def api_proxy_status():
    """Get current proxy status."""
    device_info = await device_mgr.get_device_info() if device_mgr.selected_device_id else None
    count = await count_requests()
    return ProxyStatus(
        state=ProxyState.RUNNING if proxy_mgr.running else ProxyState.STOPPED,
        port=proxy_mgr.port,
        active_device=device_info,
        request_count=count,
    )


@app.post("/api/proxy/start")
async def api_proxy_start(req: ProxyStartRequest):
    """Start the proxy server on the specified port."""
    if proxy_mgr.running:
        raise HTTPException(status_code=409, detail="Proxy already running")

    # Reload rules
    rules = await get_enabled_rules()
    override_engine.load_rules(rules)
    proxy_mgr.set_override_matcher(override_engine.create_matcher())

    try:
        await proxy_mgr.start(port=req.port, on_request=on_request_captured)
    except Exception as e:
        logger.exception("Failed to start proxy")
        raise HTTPException(status_code=500, detail=str(e))

    # Select device if provided
    if req.device_id:
        await device_mgr.select_device(req.device_id)

    return {"success": True, "port": req.port}


@app.post("/api/proxy/stop")
async def api_proxy_stop():
    """Stop the proxy server."""
    if proxy_mgr.running:
        await proxy_mgr.stop()
        await device_mgr.teardown_all_forwards()
    return {"success": True}


# ── Requests ────────────────────────────────────────────────────────

@app.get("/api/requests", response_model=List[CapturedRequest])
async def api_list_requests(
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    url: Optional[str] = Query(default=None),
    method: Optional[str] = Query(default=None),
):
    """List captured requests with optional filtering."""
    return await list_requests(limit=limit, offset=offset, url_filter=url, method_filter=method)


@app.get("/api/requests/stream")
async def api_requests_stream(request: Request):
    """SSE endpoint for live request streaming."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=256)
    _sse_queues.add(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=15.0)
                    if data is None:  # Sentinel
                        break
                    yield {"event": "request", "data": json.dumps(data)}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        finally:
            _sse_queues.discard(queue)

    return EventSourceResponse(event_generator())


@app.get("/api/requests/{request_id}", response_model=CapturedRequest)
async def api_get_request(request_id: str):
    """Get a single request by ID."""
    req = await get_request(request_id)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


@app.delete("/api/requests")
async def api_clear_requests():
    """Delete all captured requests."""
    await clear_requests()
    return {"success": True}


# ── Override Rules ──────────────────────────────────────────────────

@app.get("/api/rules", response_model=List[OverrideRule])
async def api_list_rules():
    """List all override rules."""
    return await list_rules()


@app.post("/api/rules", response_model=OverrideRule)
async def api_create_rule(rule: OverrideRule):
    """Create a new override rule. The id field, if provided, is used; otherwise a UUID is generated."""
    if not rule.id or rule.id == '':
        rule.id = str(uuid.uuid4())
    result = await create_rule(rule)
    # Hot-reload rules into engine
    await _reload_rules()
    return result


@app.get("/api/rules/{rule_id}", response_model=OverrideRule)
async def api_get_rule(rule_id: str):
    """Get a single rule."""
    from .db import get_rule as db_get_rule
    rule = await db_get_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@app.put("/api/rules/{rule_id}", response_model=OverrideRule)
async def api_update_rule(rule_id: str, updates: dict):
    """Update an override rule."""
    rule = await update_rule(rule_id, updates)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await _reload_rules()
    return rule


@app.delete("/api/rules/{rule_id}")
async def api_delete_rule(rule_id: str):
    """Delete an override rule."""
    ok = await delete_rule(rule_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Rule not found")
    await _reload_rules()
    return {"success": True}


@app.patch("/api/rules/{rule_id}/toggle", response_model=OverrideRule)
async def api_toggle_rule(rule_id: str):
    """Toggle an override rule's enabled state."""
    rule = await toggle_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    await _reload_rules()
    return rule


@app.post("/api/rules/preview")
async def api_preview_rule(rule: OverrideRule):
    """Preview which past requests would match a rule (without creating it)."""
    from .db import list_requests
    requests = await list_requests(limit=500)
    matched = []

    engine = OverrideEngine()
    engine.load_rules([rule])

    for r in requests:
        # Simplified matching (no flow object, just URL check)
        applicable = engine.get_applicable_rules_for_url(r.url, r.method.value)
        if applicable:
            matched.append({
                "id": r.id,
                "url": r.url,
                "method": r.method.value,
                "matched_rule": rule.name or rule.id,
            })

    return {"total_scanned": len(requests), "matched": len(matched), "matches": matched}


async def _reload_rules():
    """Hot-reload rules into the engine and proxy."""
    rules = await get_enabled_rules()
    override_engine.load_rules(rules)
    proxy_mgr.set_override_matcher(override_engine.create_matcher())


# ── Certificate Download ────────────────────────────────────────────

@app.get("/api/cert/download")
async def api_download_cert():
    """Download the CA certificate for device installation."""
    cert_path = proxy_mgr.generate_ca_cert()
    if not cert_path.exists():
        # Return instructions instead
        return {
            "message": "CA certificate will be generated on first HTTPS connection. "
                       "Start the proxy and browse an HTTPS site first.",
            "path": str(cert_path),
        }
    return FileResponse(
        cert_path,
        media_type="application/x-pem-file",
        filename="prism-ca-cert.pem",
    )


# ── Capture (unified dual-backend) ──────────────────────────────────

@app.get("/api/capture/status")
async def api_capture_status():
    """Get unified capture status."""
    return {
        "running": capture_mgr.running,
        "backend_type": capture_mgr.backend_type,
        "supports_overrides": capture_mgr.supports_overrides,
        "proxy_port": capture_mgr.proxy_port,
        "proxy_ca_path": capture_mgr.proxy_ca_path,
    }


@app.post("/api/capture/start")
async def api_capture_start(req: dict):
    """Start capture with specified backend.

    Body:
      - mode: "grpc" or "proxy"
      - pid: target app PID (gRPC mode, required)
      - port: proxy port (proxy mode, default 8080)
      - host_port: gRPC forward port (gRPC mode, default 50051)
    """
    if capture_mgr.running:
        raise HTTPException(status_code=409, detail="Capture already running")

    capture_mgr.set_callback(on_request_captured)

    mode = req.get("mode", "grpc")
    try:
        if mode == "grpc":
            pid = req.get("pid")
            if not pid:
                raise HTTPException(status_code=400, detail="'pid' required for gRPC mode")
            host_port = req.get("host_port", 50051)
            await capture_mgr.start_grpc(pid=int(pid), host_port=int(host_port))
        elif mode == "proxy":
            port = req.get("port", 8080)
            # Reload rules for override support
            rules = await get_enabled_rules()
            override_engine.load_rules(rules)
            await capture_mgr.start_proxy(port=int(port))
            await capture_mgr.set_overrides(rules)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown mode: {mode}")
    except Exception as e:
        logger.exception("Failed to start capture")
        msg = str(e)
        # Translate gRPC errors to human-readable messages
        if "UNAVAILABLE" in msg:
            msg = "Device is offline or hiprofilerd is not running. Check device connection and retry."
        elif "hiprofilerd is not available" in msg:
            msg = "gRPC mode not supported on this device (no hiprofilerd). Use proxy mode for emulators."
        elif "create plugin sessions failed" in msg:
            msg = "A stale profiler session is blocking new captures. Restart hiprofilerd or reselect the device."
        elif "Failed to forward port" in msg:
            msg = "Port conflict — another process may be using the forward port. Try restarting prism."
        raise HTTPException(status_code=500, detail=msg)

    return {"success": True, "mode": mode, "backend_type": capture_mgr.backend_type}


@app.post("/api/capture/stop")
async def api_capture_stop():
    """Stop active capture."""
    if not capture_mgr.running:
        raise HTTPException(status_code=409, detail="Capture not running")
    await capture_mgr.stop()
    await device_mgr.teardown_all_forwards()
    return {"success": True}


@app.post("/api/capture/kill-app")
async def api_kill_app(req: dict):
    """Kill and optionally restart a process on the device."""
    pid = req.get("pid")
    if not pid:
        raise HTTPException(status_code=400, detail="pid is required")
    package = req.get("name", "")
    restart = req.get("restart", False)

    killed = await device_mgr.kill_process(int(pid), package)
    restarted = False
    if restart and package:
        import asyncio
        await asyncio.sleep(0.8)
        restarted = await device_mgr.start_app(package)

    return {"success": killed, "pid": pid, "restarted": restarted}


@app.get("/api/capture/apps")
async def api_capture_apps():
    """List debuggable apps for gRPC mode."""
    if not device_mgr.selected_device_id:
        return []
    return await capture_mgr.get_debuggable_apps()


# ── Web UI ──────────────────────────────────────────────────────────

_STATIC_DIR = Path(__file__).parent.parent / "webui" / "dist"


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main Web UI."""
    index_path = _STATIC_DIR / "index.html"
    if index_path.exists():
        return index_path.read_text(encoding="utf-8")
    return HTMLResponse("<h1>prism Web UI not found</h1>", status_code=404)


# Mount static files after explicit routes
if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

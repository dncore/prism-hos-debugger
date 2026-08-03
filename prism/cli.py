"""CLI entry point for PRISM HTTP debugger."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import signal
import subprocess
import sys


def _setup_logging(verbose: bool = False) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="prism",
        description="Chrome DevTools-style HTTP debugging proxy for HarmonyOS devices",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # ── list-devices ────────────────────────────────────────────────
    list_parser = subparsers.add_parser(
        "list-devices",
        help="List connected HarmonyOS devices",
    )
    list_parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed device information",
    )

    # ── start ────────────────────────────────────────────────────────
    start_parser = subparsers.add_parser(
        "start",
        help="Start the proxy and Web UI",
    )
    start_parser.add_argument(
        "-p", "--port",
        type=int,
        default=8080,
        help="Proxy listen port (default: 8080)",
    )
    start_parser.add_argument(
        "-w", "--web-port",
        type=int,
        default=8900,
        help="Web UI port (default: 8900)",
    )
    start_parser.add_argument(
        "-d", "--device",
        type=str,
        default=None,
        help="Device ID to connect to automatically",
    )
    start_parser.add_argument(
        "--no-open",
        action="store_true",
        help="Don't open browser automatically",
    )
    start_parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable debug logging",
    )

    # ── stop ─────────────────────────────────────────────────────────
    stop_parser = subparsers.add_parser(
        "stop",
        help="Stop a running prism instance",
    )

    # ── export ───────────────────────────────────────────────────────
    export_parser = subparsers.add_parser(
        "export-har",
        help="Export captured requests as HAR (HTTP Archive) file",
    )
    export_parser.add_argument(
        "-o", "--output",
        type=str,
        default="prism-export.har",
        help="Output file path (default: prism-export.har)",
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    _setup_logging(verbose=getattr(args, "verbose", False))

    if args.command == "list-devices":
        asyncio.run(_cmd_list_devices(verbose=args.verbose))
    elif args.command == "start":
        asyncio.run(_cmd_start(args))
    elif args.command == "stop":
        asyncio.run(_cmd_stop())
    elif args.command == "export-har":
        asyncio.run(_cmd_export_har(args.output))
    else:
        parser.print_help()
        sys.exit(1)


# ── Commands ────────────────────────────────────────────────────────

async def _cmd_list_devices(verbose: bool = False) -> None:
    """List all connected HarmonyOS devices."""
    from .device_manager import DeviceManager

    mgr = DeviceManager()
    if not mgr.available:
        print("hdc binary not found. Make sure DevEco Studio or hdc CLI is installed.")
        print("Expected locations:")
        print("  - /Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc")
        print("  - ~/Library/Huawei/Sdk/harmonyos/toolchains/hdc")
        print("  - Or set HDC_BIN environment variable")
        sys.exit(1)

    print("Scanning for devices...")
    devices = await mgr.list_devices()

    if not devices:
        print("No devices found. Connect a HarmonyOS device via USB or network.")
        print("To connect via network: hdc tconn <device-ip>:8710")
        return

    print(f"\nFound {len(devices)} device(s):\n")
    for device in devices:
        status_icon = {
            "online": "🟢",
            "offline": "🔴",
            "unauthorized": "🟡",
        }.get(device.status.value, "⚪")

        print(f"  {status_icon} {device.device_id}")
        if verbose or device.name:
            print(f"     Name:      {device.name or '(unknown)'}")
            print(f"     Transport: {device.transport}")
            print(f"     Status:    {device.status.value}")
        if device.model:
            print(f"     Model:     {device.model}")
        if device.version:
            print(f"     Version:   {device.version}")
        print()


def _kill_port_owner(port: int, context: str = "") -> bool:
    """Find and kill the process occupying a TCP port (best-effort).

    Only kills processes whose command line looks like a prism/uvicorn
    instance, to avoid nuking unrelated services that happen to share
    the port. Returns True if something was killed.
    """
    try:
        lsof = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}"],
            capture_output=True, text=True, timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False

    if lsof.returncode != 0 or not lsof.stdout.strip():
        return False  # Port is free

    killed = False
    for pid in lsof.stdout.strip().split("\n"):
        pid = pid.strip()
        if not pid:
            continue
        try:
            ps = subprocess.run(
                ["ps", "-p", pid, "-o", "command="],
                capture_output=True, text=True, timeout=5,
            )
            cmd = ps.stdout.strip().lower()
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

        # Only kill processes that look like a previous prism instance
        if any(k in cmd for k in ("uvicorn", "prism", "webui_server")):
            try:
                os.kill(int(pid), signal.SIGKILL)
                killed = True
                print(f"  Killed stale process {pid} holding port {port}{' (' + context + ')' if context else ''}")
            except (ProcessLookupError, PermissionError):
                continue

    return killed


async def _cmd_start(args) -> None:
    """Start the prism proxy and Web UI."""
    import uvicorn

    from .db import init_db
    from pathlib import Path
    import webbrowser

    # Free any stale process on the web port before binding
    if _kill_port_owner(args.web_port, "web UI"):
        import time as _time
        _time.sleep(0.5)

    db_path = str(Path.home() / ".prism-hos-debugger" / "prism.db")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    await init_db(db_path)

    print(f"Starting PRISM HTTP Debugger...")
    print(f"  Proxy port:  {args.port}")
    print(f"  Web UI:      http://localhost:{args.web_port}")
    print(f"  API docs:    http://localhost:{args.web_port}/docs")

    if args.device:
        print(f"  Auto-connect device: {args.device}")

    if not args.no_open:
        webbrowser.open(f"http://localhost:{args.web_port}")

    config = uvicorn.Config(
        "prism.webui_server:app",
        host="127.0.0.1",
        port=args.web_port,
        log_level="info",
        reload=False,
    )
    server = uvicorn.Server(config)
    await server.serve()


async def _cmd_stop() -> None:
    """Stop a running prism instance."""
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post("http://localhost:8900/api/proxy/stop", timeout=5.0)
            if resp.status_code == 200:
                print("Proxy stopped.")
            else:
                print(f"Unexpected response: {resp.status_code}")
    except httpx.ConnectError:
        print("No running prism instance found (port 8900 not reachable).")
    except Exception as e:
        print(f"Failed to stop: {e}")


async def _cmd_export_har(output_path: str) -> None:
    """Export captured requests as HAR format."""
    from .db import init_db, list_requests
    from pathlib import Path
    import json

    db_path = str(Path.home() / ".prism-hos-debugger" / "prism.db")
    await init_db(db_path)

    requests = await list_requests(limit=10000)

    # Build HAR 1.2 format
    entries = []
    for r in requests:
        timings = {
            "dns": r.dns_duration_ms if r.dns_duration_ms > 0 else -1,
            "connect": r.connect_duration_ms if r.connect_duration_ms > 0 else -1,
            "ssl": r.tls_duration_ms if r.tls_duration_ms > 0 else -1,
            "send": 0,
            "wait": r.ttfb_ms if r.ttfb_ms > 0 else 0,
            "receive": r.total_duration_ms - r.ttfb_ms if r.total_duration_ms > r.ttfb_ms else 0,
            "blocked": 0,
        }

        entries.append({
            "startedDateTime": r.timestamp.isoformat(),
            "time": r.total_duration_ms,
            "request": {
                "method": r.method.value,
                "url": r.url,
                "httpVersion": "HTTP/1.1",
                "headers": [{"name": k, "value": v} for k, v in r.request_headers.items()],
                "queryString": [],
                "cookies": [],
                "headersSize": sum(len(k) + len(v) for k, v in r.request_headers.items()),
                "bodySize": r.request_body_size,
                "postData": {
                    "mimeType": r.content_type,
                    "text": r.request_body or "",
                } if r.request_body else None,
            },
            "response": {
                "status": r.response_status or 0,
                "statusText": str(r.response_status or ""),
                "httpVersion": "HTTP/1.1",
                "headers": [{"name": k, "value": v} for k, v in r.response_headers.items()],
                "cookies": [],
                "content": {
                    "size": r.response_body_size,
                    "mimeType": r.content_type,
                    "text": r.response_body or "",
                } if r.response_body else {"size": 0, "mimeType": ""},
                "redirectURL": "",
                "headersSize": sum(len(k) + len(v) for k, v in r.response_headers.items()),
                "bodySize": r.response_body_size,
            },
            "cache": {},
            "timings": timings,
            "serverIPAddress": r.remote_address.split(":")[0] if r.remote_address else "",
            "_prism_meta": {
                "intercepted": r.intercepted,
                "rule_id": r.rule_id,
                "error": r.error,
            },
        })

    har = {
        "log": {
            "version": "1.2",
            "creator": {"name": "prism-hos-debugger", "version": "0.2.0"},
            "entries": entries,
        }
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(har, f, indent=2, ensure_ascii=False)

    print(f"Exported {len(entries)} requests to {output_path}")


if __name__ == "__main__":
    main()

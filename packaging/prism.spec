# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for prism-hos-debugger macOS .app bundle."""

import os
import sys
from pathlib import Path

_ROOT = Path(SPECPATH).parent if 'SPECPATH' in dir() else Path.cwd()

# ── Collect mitmproxy hidden imports ────────────────────────────
mitmproxy_imports = [
    "mitmproxy.addons",
    "mitmproxy.addons.termlog",
    "mitmproxy.addons.proxyserver",
    "mitmproxy.addons.next_layer",
    "mitmproxy.addons.script",
    "mitmproxy.addons.stickycookie",
    "mitmproxy.addons.streambodies",
    "mitmproxy.addons.readfile",
    "mitmproxy.addons.onboarding",
    "mitmproxy.addons.modifybody",
    "mitmproxy.addons.modifyheaders",
    "mitmproxy.addons.mapremote",
    "mitmproxy.addons.maplocal",
    "mitmproxy.addons.cut",
    "mitmproxy.addons.clientplayback",
    "mitmproxy.addons.blocklist",
    "mitmproxy.addons.anticomp",
    "mitmproxy.addons.anticache",
    "mitmproxy.addons.allowremote",
    "mitmproxy.addons.serverplayback",
    "mitmproxy.addons.upstream_auth",
    "mitmproxy.proxy.server",
    "mitmproxy.proxy.mode_servers",
    "mitmproxy.proxy.layers",
    "mitmproxy.proxy.layers.http",
    "mitmproxy.proxy.layers.tls",
    "mitmproxy.proxy.layers.websocket",
    "mitmproxy.proxy.layers.http._http_connect",
    "mitmproxy.proxy.layers.http._http_connect_tunneling",
    "mitmproxy.proxy.layers.http._upstream_proxy",
    "mitmproxy.connection",
    "mitmproxy.net",
    "mitmproxy.net.http",
    "mitmproxy.net.http.headers",
    "mitmproxy.net.http.request",
    "mitmproxy.net.http.response",
    "mitmproxy.net.tls",
    "mitmproxy.http",
    "mitmproxy.websocket",
    "mitmproxy.tcp",
    "mitmproxy.udp",
    "mitmproxy.dns",
    "mitmproxy.certs",
    "mitmproxy.options",
    "mitmproxy.master",
    "mitmproxy.log",
    "mitmproxy.flow",
    "mitmproxy.types",
    "mitmproxy.contentviews",
    "passlib.handlers",
    "passlib.handlers.bcrypt",
    "passlib.handlers.sha2_crypt",
    "passlib.handlers.des_crypt",
    "passlib.handlers.ldap_digests",
    "passlib.handlers.md5_crypt",
    "passlib.handlers.misc",
    "passlib.handlers.sha1_crypt",
    "passlib.handlers.digests",
    "google.protobuf",
    "google.protobuf.descriptor",
    "google.protobuf.descriptor_pool",
    "google.protobuf.message",
    "google.protobuf.reflection",
    "google.protobuf.symbol_database",
    "google.protobuf.text_format",
    "google.protobuf.json_format",
    "google.protobuf.internal",
    "google.protobuf.internal.containers",
    "google.protobuf.internal.encoder",
    "google.protobuf.internal.decoder",
    "google.protobuf.internal.wire_format",
    "google.protobuf.internal.type_checkers",
]

# ── Collect data files ──────────────────────────────────────────

datas = []

# Web UI (built frontend)
webui_dist = _ROOT / "webui" / "dist"
if webui_dist.exists():
    datas.append((str(webui_dist), "webui/dist"))

# Protobuf definitions (for runtime type resolution)
proto_dir = _ROOT / "prism" / "proto"
for f in proto_dir.glob("*.proto"):
    datas.append((str(f), f"prism/proto/{f.name}"))

# ── macOS .app bundle ───────────────────────────────────────────

app_name = "Prism"
bundle_identifier = "com.prism.debugger"

info_plist = {
    "CFBundleName": app_name,
    "CFBundleDisplayName": "Prism HTTP Debugger",
    "CFBundleIdentifier": bundle_identifier,
    "CFBundleVersion": "0.3.0",
    "CFBundleShortVersionString": "0.3.0",
    "CFBundlePackageType": "APPL",
    "CFBundleExecutable": app_name.lower(),
    "NSHighResolutionCapable": True,
    "LSBackgroundOnly": False,
}

# ── Analysis ────────────────────────────────────────────────────

a = Analysis(
    [str(_ROOT / "prism" / "cli.py")],
    pathex=[str(_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=mitmproxy_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "numpy",
        "pandas",
        "PIL",
        "cv2",
        "scipy",
        "IPython",
        "jupyter",
        "notebook",
        "wx",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name=app_name.lower(),
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Show terminal for debugging; set to False for release
    argv_emulation=True,  # macOS: pass arguments via Apple Events
    target_arch="arm64",  # Apple Silicon only
    codesign_identity=None,
    entitlements_file=None,
    icon=str(_ROOT / "assets" / "prism.icns") if (_ROOT / "assets" / "prism.icns").exists() else None,
)

# ── .app bundle ─────────────────────────────────────────────────

app = BUNDLE(
    exe,
    name=f"{app_name}.app",
    icon=str(_ROOT / "assets" / "prism.icns") if (_ROOT / "assets" / "prism.icns").exists() else None,
    bundle_identifier=bundle_identifier,
    info_plist=info_plist,
)

"""Data models for PRISM HTTP debugger."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Device ──────────────────────────────────────────────────────────

class DeviceStatus(str, Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    UNAUTHORIZED = "unauthorized"


class Device(BaseModel):
    """A connected HarmonyOS device detected by hdc."""
    device_id: str
    name: str = ""
    status: DeviceStatus = DeviceStatus.ONLINE
    transport: str = "usb"  # "usb" | "tcp"
    model: str = ""
    version: str = ""


class ProxyState(str, Enum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    ERROR = "error"


# ── HTTP Capture ────────────────────────────────────────────────────

class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"
    HEAD = "HEAD"
    OPTIONS = "OPTIONS"
    CONNECT = "CONNECT"


class CapturedRequest(BaseModel):
    """A single captured HTTP request/response pair."""
    id: str  # unique ID
    url: str
    method: HttpMethod
    scheme: str = "http"  # "http" | "https"

    # Request
    request_headers: Dict[str, str] = Field(default_factory=dict)
    request_body: Optional[str] = None
    request_body_size: int = 0

    # Response
    response_status: Optional[int] = None
    response_headers: Dict[str, str] = Field(default_factory=dict)
    response_body: Optional[str] = None
    response_body_size: int = 0

    # Timing (milliseconds)
    timestamp: datetime = Field(default_factory=datetime.now)
    dns_duration_ms: float = 0.0
    connect_duration_ms: float = 0.0
    tls_duration_ms: float = 0.0
    ttfb_ms: float = 0.0          # time to first byte
    total_duration_ms: float = 0.0

    # Metadata
    is_https: bool = False
    intercepted: bool = False      # whether this hit an override rule
    rule_id: Optional[str] = None   # which override rule matched (if any)
    error: Optional[str] = None     # connection error message (if any)
    remote_address: str = ""
    content_type: str = ""

    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat()},
    )


# ── Override Rules ──────────────────────────────────────────────────

class OverrideType(str, Enum):
    URL_REDIRECT = "url_redirect"
    HEADER_MODIFY = "header_modify"
    RESPONSE_STATUS = "response_status"
    RESPONSE_BODY = "response_body"
    RESPONSE_HEADERS = "response_headers"
    LATENCY = "latency"
    BLOCK = "block"


class MatchType(str, Enum):
    EXACT = "exact"
    PREFIX = "prefix"
    REGEX = "regex"
    GLOB = "glob"


class OverrideRule(BaseModel):
    """An override rule defining request matching and action."""
    id: str = ""  # unique ID (auto-generated if empty)
    name: str = ""
    enabled: bool = True

    # Match conditions
    match_type: MatchType = MatchType.GLOB
    match_pattern: str = ""        # URL pattern to match
    match_method: Optional[HttpMethod] = None  # None = all methods

    # Override action
    override_type: OverrideType

    # Action payloads (relevant field depends on override_type)
    redirect_url: Optional[str] = None           # URL_REDIRECT
    request_headers_to_add: Dict[str, str] = Field(default_factory=dict)   # HEADER_MODIFY
    request_headers_to_remove: List[str] = Field(default_factory=list)
    response_status_override: Optional[int] = None   # RESPONSE_STATUS
    response_body_override: Optional[str] = None     # RESPONSE_BODY
    response_headers_to_add: Dict[str, str] = Field(default_factory=dict)  # RESPONSE_HEADERS
    response_headers_to_remove: List[str] = Field(default_factory=list)
    latency_ms: int = 0                            # LATENCY
    # BLOCK has no extra payload

    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)

    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat()},
    )


# ── API Response Models ─────────────────────────────────────────────

class ProxyStatus(BaseModel):
    state: ProxyState
    port: int = 8080
    active_device: Optional[Device] = None
    request_count: int = 0
    error: Optional[str] = None


class ProxyStartRequest(BaseModel):
    port: int = 8080
    device_id: Optional[str] = None


class DeviceSelectRequest(BaseModel):
    device_id: str
    proxy_port: int = 8080

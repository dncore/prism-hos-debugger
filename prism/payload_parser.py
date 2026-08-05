"""Parse NetworkProfilerEvent.payload bytes into CapturedRequest.

Payload format: ProtoEncoder (custom flat TLV binary encoding).

Format:
  [4 bytes: field_type (uint32 LE)] [4 bytes: value_length (uint32 LE)] [N bytes: value]
  type=1: int64 (8 bytes)  — timing timestamps
  type=2: int32 (4 bytes)  — responseStatusCode
  type=3: string (N bytes) — URL, method, headers, body

Field order maps to HttpOriginalPo:
  1-7:  timing (requestBeginTime, dnsEndTime, tcpConnectEndTime, tlsHandshakeEndTime,
                  firstSendTime, firstRecvTime, requestEndTime)
  8:    requestUrl (string)
  9:    requestMethod (string)
  10:   requestHeaders (string)
  11:   responseStatusCode (int32)
  12-17: responseEffectiveUrl, responseIpAddress, responseHttpVersion,
         responseReasonPhrase, responseHeaders, responseBody (strings)

Fallback: JSON format (HttpOriginalDto) for some plugin versions.

Reverse-engineered from DevEco Studio ohos-profiler v26.0.0.461.
"""

from __future__ import annotations

import json
import logging
import struct
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from .models import CapturedRequest, HttpMethod

logger = logging.getLogger(__name__)


class PayloadParser:
    """Parses NetworkProfilerEvent payload bytes into CapturedRequest models.

    Primary format: ProtoEncoder (flat TLV binary) — used by network-profiler plugin.
    Fallback format: JSON HttpOriginalDto — for compatibility with other versions.

    Each event contains BOTH request metadata AND response headers/body
    in a single payload — no correlation needed.
    """

    def __init__(self):
        pass

    def parse_event(
        self,
        payload: bytes,
        event_type: int = 0,
        tv_sec: int = 0,
        tv_nsec: int = 0,
        pid: int = 0,
        tid: int = 0,
        process_name: str = "",
        thread_name: str = "",
    ) -> Optional[CapturedRequest]:
        """Parse a single NetworkProfilerEvent into a CapturedRequest."""
        if not payload:
            return None

        # Try ProtoEncoder binary format first
        result = self._parse_protoencoder(payload, tv_sec, tv_nsec,
                                          pid, tid, process_name, thread_name)
        if result is not None:
            return result

        # Fallback to JSON
        return self._parse_json(payload, tv_sec, tv_nsec,
                                pid, tid, process_name, thread_name)

    # ── ProtoEncoder binary parser ───────────────────────────────

    def _parse_protoencoder(
        self, data: bytes, tv_sec: int, tv_nsec: int,
        pid: int, tid: int, process_name: str, thread_name: str,
    ) -> Optional[CapturedRequest]:
        """Parse ProtoEncoder TLV binary format.

        Format: repeated { type:uint32_le, len:uint32_le, value:bytes }
        Type 1 = int64 (8 bytes), Type 2 = int32 (4 bytes), Type 3 = string.
        """
        timestamps = []   # 7x int64 in order
        status_code = 0   # int32 field
        req_strings: list[str] = []   # strings before status_code (request)
        res_strings: list[str] = []   # strings after status_code (response)
        seen_status = False

        pos = 0
        try:
            while pos + 8 <= len(data):
                field_type = struct.unpack_from("<I", data, pos)[0]
                field_len = struct.unpack_from("<I", data, pos + 4)[0]
                pos += 8

                if pos + field_len > len(data):
                    break

                if field_type == 1 and field_len == 8:
                    val = struct.unpack_from("<q", data, pos)[0]
                    timestamps.append(val)
                elif field_type == 2 and field_len == 4:
                    val = struct.unpack_from("<i", data, pos)[0]
                    status_code = val
                    seen_status = True
                elif field_type == 3:
                    val = data[pos:pos + field_len].decode("utf-8", errors="replace")
                    if seen_status:
                        res_strings.append(val)
                    else:
                        req_strings.append(val)

                pos += field_len
        except (struct.error, UnicodeDecodeError):
            return None

        if not req_strings and not res_strings:
            return None

        # ── Classify request-side strings ──────────────────────
        url = ""
        method_str = "GET"
        req_headers_raw = ""
        req_body = ""

        http_methods = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "CONNECT"}

        for s in req_strings:
            if s.startswith("http://") or s.startswith("https://"):
                if not url:
                    url = s
            elif s.strip().upper() in http_methods:
                method_str = s.strip().upper()
            elif "\n" in s and ":" in s:
                req_headers_raw = s
            elif s.strip():
                # Non-empty, not URL/method/headers → candidate request body
                if len(s) > len(req_body) and not s.strip().lstrip('-').isdigit():
                    req_body = s

        # ── Classify response-side strings ──────────────────────
        res_headers_raw = ""
        res_body = ""
        remote_addr = ""

        for s in res_strings:
            if s.startswith("http://") or s.startswith("https://"):
                pass  # responseEffectiveUrl, skip
            elif s.startswith("HTTP/") or ("\n" in s and any(
                line.strip().startswith(h) for h in ["HTTP/", "Content-", "Transfer-", "Connection:", "Date:", "Server:", "Cache-"]
                for line in s.split("\n")[:3]
            )):
                if not res_headers_raw or len(s) > len(res_headers_raw):
                    res_headers_raw = s
            elif "\n" in s and ":" in s:
                if "HTTP/" in s[:20]:
                    res_headers_raw = s
                elif len(s) > len(res_headers_raw):
                    res_headers_raw = s
            elif s.strip():
                # Non-header string → response body
                if len(s) > len(res_body):
                    res_body = s

        # Extract response body from combined header+body
        if res_headers_raw and not res_body:
            parts = res_headers_raw.split("\n\n", 1)
            if len(parts) == 2:
                res_headers_raw = parts[0]
                res_body = parts[1]

        try:
            method = HttpMethod(method_str.upper())
        except ValueError:
            method = HttpMethod.GET

        # Parse timing from timestamps (microseconds since boot)
        def _us_to_ms(vals: list, idx: int, prev_idx: int) -> float:
            if len(vals) > idx and len(vals) > prev_idx:
                return (vals[idx] - vals[prev_idx]) / 1000.0
            return 0.0

        total_ms = 0.0
        if len(timestamps) >= 7:
            total_ms = (timestamps[6] - timestamps[0]) / 1000.0

        timing = dict(
            dns_duration_ms=round(_us_to_ms(timestamps, 1, 0), 2),
            connect_duration_ms=round(_us_to_ms(timestamps, 2, 1), 2),
            tls_duration_ms=round(_us_to_ms(timestamps, 3, 2), 2),
            ttfb_ms=round(_us_to_ms(timestamps, 5, 4), 2),
            total_duration_ms=round(total_ms, 2),
        )

        # Parse headers
        req_headers = self._parse_raw_headers(req_headers_raw)
        res_headers = self._parse_raw_headers(res_headers_raw)

        # Timestamp
        if tv_sec > 0:
            timestamp = datetime.fromtimestamp(tv_sec + tv_nsec / 1e9, tz=timezone.utc)
        else:
            timestamp = datetime.now(tz=timezone.utc)

        return CapturedRequest(
            id=str(uuid.uuid4()),
            url=url,
            method=method,
            scheme="https" if url.startswith("https://") else "http",
            request_headers=req_headers,
            request_body=req_body if req_body else None,
            request_body_size=len(req_body.encode("utf-8")) if req_body else 0,
            response_status=status_code if status_code > 0 else 0,
            response_headers=res_headers,
            response_body=res_body if res_body else None,
            response_body_size=len(res_body.encode("utf-8")) if res_body else 0,
            timestamp=timestamp,
            is_https=url.startswith("https://"),
            intercepted=False,
            rule_id=None,
            error=None,
            remote_address=remote_addr,
            content_type=res_headers.get("content-type", ""),
            **timing,
        )

    @staticmethod
    def _parse_raw_headers(raw: str) -> Dict[str, str]:
        """Parse \n-separated headers into a dict."""
        if not raw:
            return {}
        headers = {}
        for line in raw.split("\n"):
            line = line.strip()
            if ":" in line:
                key, _, value = line.partition(":")
                headers[key.strip().lower()] = value.strip()
        return headers

    # ── JSON fallback parser ─────────────────────────────────────

    def _parse_json(
        self, payload: bytes, tv_sec: int, tv_nsec: int,
        pid: int, tid: int, process_name: str, thread_name: str,
    ) -> Optional[CapturedRequest]:
        """Fallback JSON parser for HttpOriginalDto format."""
        try:
            text = payload.decode("utf-8", errors="replace")
            data = json.loads(text)
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Try concatenated JSON objects
            data = self._parse_concatenated_json(text)
            if not data:
                return None

        if "originalPO" in data or "headerAndResponsePO" in data:
            original = data.get("originalPO", {}) or {}
            header_resp = data.get("headerAndResponsePO", {}) or {}
            return self._build_request_from_json(original, header_resp, tv_sec, tv_nsec)

        # Standalone PO
        if "requestUrl" in data or "requestMethod" in data:
            return self._build_request_from_json(data, {}, tv_sec, tv_nsec,
                                                 pid, tid, process_name, thread_name)
        else:
            return self._build_request_from_json({}, data, tv_sec, tv_nsec,
                                                 pid, tid, process_name, thread_name)

    def _build_request_from_json(
        self, original: dict, header_resp: dict,
        tv_sec: int = 0, tv_nsec: int = 0,
        pid: int = 0, tid: int = 0,
        process_name: str = "", thread_name: str = "",
    ) -> CapturedRequest:
        """Build a CapturedRequest from JSON-parsed data."""
        url = original.get("requestUrl", "") or header_resp.get("requestUrl", "")
        method_str = original.get("requestMethod", "GET") or "GET"
        try:
            method = HttpMethod(method_str.upper())
        except ValueError:
            method = HttpMethod.GET

        status = original.get("responseStatusCode") or 0
        if isinstance(status, str):
            try:
                status = int(status)
            except ValueError:
                status = 0

        request_begin = original.get("requestBeginTime", 0) or 0
        dns_end = original.get("dnsEndTime", 0) or 0
        tcp_end = original.get("tcpConnectEndTime", 0) or 0
        tls_end = original.get("tlsHandshakeEndTime", 0) or 0
        first_send = original.get("firstSendTime", 0) or 0
        first_recv = original.get("firstRecvTime", 0) or 0
        request_end = original.get("requestEndTime", 0) or 0

        def _us(val):
            return val / 1000.0

        req_headers = self._parse_raw_headers(header_resp.get("requestHeader", ""))
        req_body = header_resp.get("requestBody", "") or original.get("requestBody", "")
        res_headers = self._parse_raw_headers(header_resp.get("responseHeader", ""))
        response_body = header_resp.get("responseBody", "")

        if tv_sec > 0:
            timestamp = datetime.fromtimestamp(tv_sec + tv_nsec / 1e9, tz=timezone.utc)
        else:
            timestamp = datetime.now(tz=timezone.utc)

        return CapturedRequest(
            id=str(uuid.uuid4()),
            url=url,
            method=method,
            scheme="https" if url.startswith("https://") else "http",
            request_headers=req_headers,
            request_body=req_body if req_body else None,
            request_body_size=len(req_body.encode("utf-8")) if req_body else 0,
            response_status=status,
            response_headers=res_headers,
            response_body=response_body if response_body else None,
            response_body_size=len(response_body.encode("utf-8")) if response_body else 0,
            timestamp=timestamp,
            dns_duration_ms=round(_us(dns_end - request_begin) if dns_end > request_begin else 0, 2),
            connect_duration_ms=round(_us(tcp_end - dns_end) if tcp_end > dns_end else 0, 2),
            tls_duration_ms=round(_us(tls_end - tcp_end) if tls_end > tcp_end else 0, 2),
            ttfb_ms=round(_us(first_recv - first_send) if first_recv > first_send else 0, 2),
            total_duration_ms=round(_us(request_end - request_begin) if request_end > request_begin else 0, 2),
            is_https=url.startswith("https://"),
            intercepted=False,
            rule_id=None,
            error=None,
            remote_address=original.get("responseIpAddress", ""),
            content_type=res_headers.get("content-type", ""),
        )

    def flush(self) -> List[CapturedRequest]:
        """No-op: events are parsed immediately, no buffering needed."""
        return []

    @staticmethod
    def _parse_concatenated_json(text: str) -> Optional[dict]:
        """Try to parse concatenated JSON objects."""
        depth = 0; splits = []; start = 0
        for i, ch in enumerate(text):
            if ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    splits.append(text[start:i + 1]); start = i + 1
        if len(splits) >= 2:
            result = {}
            for s in splits:
                try:
                    obj = json.loads(s)
                    if "requestUrl" in obj or "requestMethod" in obj:
                        result["originalPO"] = obj
                    else:
                        result["headerAndResponsePO"] = obj
                except json.JSONDecodeError:
                    pass
            if result:
                return result
        return None

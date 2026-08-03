"""Tests for payload_parser — NetworkProfilerEvent → CapturedRequest."""

import json
import pytest
from prism.payload_parser import PayloadParser
from prism.models import HttpMethod


class TestDirectParsing:
    """Test direct JSON parsing of the two PO types."""

    def test_parse_original_po(self):
        parser = PayloadParser()
        data = {
            "sessionId": "s1",
            "requestId": "r1",
            "requestUrl": "https://api.example.com/users",
            "requestMethod": "POST",
            "responseStatusCode": 200,
            "requestBeginTime": 1000000,
            "dnsEndTime": 1005000,
            "tcpConnectEndTime": 1010000,
            "tlsHandshakeEndTime": 1020000,
            "firstSendTime": 1030000,
            "firstRecvTime": 1050000,
            "requestEndTime": 1060000,
            "responseEffectiveUrl": "https://api.example.com/users",
            "responseIpAddress": "1.2.3.4",
            "responseHttpVersion": "HTTP/1.1",
            "responseReasonPhrase": "OK",
        }
        payload = json.dumps(data).encode("utf-8")
        result = parser.parse_event(payload, event_type=0)
        # Standalone (no requestId correlation) — should still parse
        assert result is not None
        assert result.url == "https://api.example.com/users"
        assert result.method == HttpMethod.POST
        assert result.response_status == 200
        assert result.is_https is True

    def test_parse_header_response_po(self):
        parser = PayloadParser()
        data = {
            "sessionId": "s1",
            "requestId": "r1",
            "requestHeader": "host: api.example.com\ncontent-type: application/json",
            "responseHeader": "content-type: application/json\nx-request-id: abc123",
            "responseBody": '{"result": "ok"}',
        }
        payload = json.dumps(data).encode("utf-8")
        result = parser.parse_event(payload, event_type=1)
        assert result is not None
        assert result.request_headers.get("host") == "api.example.com"
        assert result.request_headers.get("content-type") == "application/json"
        assert result.response_headers.get("x-request-id") == "abc123"
        assert result.response_body == '{"result": "ok"}'
        assert result.response_body_size > 0

    def test_parse_combined_dto(self):
        """Test HttpOriginalDto containing both POs in one JSON."""
        parser = PayloadParser()
        data = {
            "originalPO": {
                "requestUrl": "http://example.com/",
                "requestMethod": "GET",
                "responseStatusCode": 200,
            },
            "headerAndResponsePO": {
                "requestHeader": "host: example.com",
                "responseHeader": "content-type: text/html",
                "responseBody": "<html>hello</html>",
            },
        }
        payload = json.dumps(data).encode("utf-8")
        result = parser.parse_event(payload, event_type=0)
        assert result is not None
        assert result.url == "http://example.com/"
        assert result.method == HttpMethod.GET
        assert result.response_status == 200
        assert result.request_headers.get("host") == "example.com"
        assert result.response_body == "<html>hello</html>"

    def test_parse_concatenated_json(self):
        """Test two JSON objects concatenated as they might arrive."""
        parser = PayloadParser()
        original = {"requestUrl": "http://example.com/", "requestMethod": "GET", "responseStatusCode": 301}
        header_resp = {"requestHeader": "host: example.com", "responseHeader": "location: /new", "responseBody": ""}
        payload = (json.dumps(original) + json.dumps(header_resp)).encode("utf-8")
        result = parser.parse_event(payload, event_type=0)
        assert result is not None
        assert result.url == "http://example.com/"
        assert result.response_status == 301
        assert result.response_headers.get("location") == "/new"


class TestEventCorrelation:
    """Each event is parsed independently — both halves produce valid requests."""

    def test_original_event_standalone(self):
        parser = PayloadParser()
        data = {
            "sessionId": "s1", "requestId": "req-1",
            "requestUrl": "https://api.example.com/data",
            "requestMethod": "PUT", "responseStatusCode": 204,
            "requestBeginTime": 2000000, "requestEndTime": 2040000,
        }
        r = parser.parse_event(json.dumps(data).encode("utf-8"), event_type=0)
        assert r is not None
        assert r.url == "https://api.example.com/data"
        assert r.method == HttpMethod.PUT
        assert r.response_status == 204

    def test_header_event_standalone(self):
        parser = PayloadParser()
        data = {
            "sessionId": "s1", "requestId": "req-1",
            "requestHeader": "authorization: Bearer xxx",
            "responseHeader": "content-type: application/json",
            "responseBody": '{"status": "deleted"}',
        }
        r = parser.parse_event(json.dumps(data).encode("utf-8"), event_type=1)
        assert r is not None
        assert r.request_headers.get("authorization") == "Bearer xxx"
        assert r.response_body == '{"status": "deleted"}'

    def test_empty_payload(self):
        parser = PayloadParser()
        assert parser.parse_event(b"", event_type=0) is None
        assert parser.parse_event(b"xxx", event_type=0) is None


class TestTiming:
    """Test timing calculations."""

    def test_timing_durations(self):
        parser = PayloadParser()
        data = {
            "requestUrl": "http://test.com/",
            "requestMethod": "GET",
            "responseStatusCode": 200,
            "requestBeginTime": 1000000,  # 1000ms
            "dnsEndTime": 1010000,        # 1010ms → dns = 10ms
            "tcpConnectEndTime": 1020000, # 1020ms → tcp = 10ms
            "tlsHandshakeEndTime": 1040000, # 1040ms → tls = 20ms
            "firstSendTime": 1050000,     # 1050ms
            "firstRecvTime": 1080000,     # 1080ms → ttfb = 30ms
            "requestEndTime": 1100000,    # 1100ms → total = 100ms
        }
        payload = json.dumps(data).encode("utf-8")
        result = parser.parse_event(payload, event_type=0)
        assert result is not None
        assert result.dns_duration_ms == 10.0
        assert result.connect_duration_ms == 10.0
        assert result.tls_duration_ms == 20.0
        assert result.ttfb_ms == 30.0
        assert result.total_duration_ms == 100.0

    def test_zero_timing(self):
        parser = PayloadParser()
        data = {
            "requestUrl": "http://test.com/",
            "requestMethod": "GET",
            "responseStatusCode": 200,
        }
        payload = json.dumps(data).encode("utf-8")
        result = parser.parse_event(payload, event_type=0)
        assert result is not None
        assert result.dns_duration_ms == 0.0
        assert result.total_duration_ms == 0.0

"""Tests for the override engine."""

import pytest
from unittest.mock import MagicMock

from prism.models import (
    MatchType,
    OverrideRule,
    OverrideType,
    HttpMethod,
)
from prism.override_engine import OverrideEngine


def make_flow(url, method="GET"):
    """Create a minimal mock HTTPFlow."""
    flow = MagicMock()
    flow.request.pretty_url = url
    flow.request.method = method
    flow.id = f"test-{url}"
    return flow


def make_rule(name="test", match_type=MatchType.GLOB, pattern="*", override_type=OverrideType.BLOCK, **kwargs):
    """Create an OverrideRule with defaults."""
    defaults = dict(
        id=f"rule-{name}",
        name=name,
        enabled=True,
        match_type=match_type,
        match_pattern=pattern,
        override_type=override_type,
    )
    defaults.update(kwargs)
    return OverrideRule(**defaults)


class TestUrlMatching:
    """Test URL pattern matching."""

    def test_glob_match_all(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(pattern="*")])
        flow = make_flow("https://api.example.com/users")
        assert engine.match(flow) is not None

    def test_glob_match_domain(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(pattern="*.example.com/*")])
        assert engine.match(make_flow("https://api.example.com/users")) is not None
        assert engine.match(make_flow("https://other.com/api")) is None

    def test_prefix_match(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(match_type=MatchType.PREFIX, pattern="https://api.example.com/")])
        assert engine.match(make_flow("https://api.example.com/users")) is not None
        assert engine.match(make_flow("https://api.example.com/posts/1")) is not None
        assert engine.match(make_flow("https://other.example.com/users")) is None

    def test_exact_match(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(match_type=MatchType.EXACT, pattern="https://api.example.com/users")])
        assert engine.match(make_flow("https://api.example.com/users")) is not None
        assert engine.match(make_flow("https://api.example.com/users/1")) is None

    def test_regex_match(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(match_type=MatchType.REGEX, pattern=r"/api/v[12]/users")])
        assert engine.match(make_flow("https://api.example.com/api/v1/users")) is not None
        assert engine.match(make_flow("https://api.example.com/api/v2/users")) is not None
        assert engine.match(make_flow("https://api.example.com/api/v3/users")) is None

    def test_method_filter(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(pattern="*", match_method=HttpMethod.POST)])
        assert engine.match(make_flow("https://api.example.com/api", "POST")) is not None
        assert engine.match(make_flow("https://api.example.com/api", "GET")) is None

    def test_multiple_rules_first_wins(self):
        engine = OverrideEngine()
        engine.load_rules([
            make_rule(name="rule1", pattern="*.example.com/*", override_type=OverrideType.BLOCK),
            make_rule(name="rule2", pattern="*.example.com/*", override_type=OverrideType.LATENCY, latency_ms=500),
        ])
        result = engine.match(make_flow("https://api.example.com/users"))
        assert result is not None
        assert result.name == "rule1"  # First rule wins

    def test_disabled_rules_not_matched(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(name="rule1", enabled=False)])
        assert engine.match(make_flow("https://api.example.com/users")) is None


class TestActionResolution:
    """Test that matched rules produce correct actions."""

    def test_block_action(self):
        engine = OverrideEngine()
        rule = make_rule(override_type=OverrideType.BLOCK)
        action = engine.get_action(make_flow("http://test.com"), rule)
        assert action["type"] == "block"
        assert action["block"] is True

    def test_redirect_action(self):
        engine = OverrideEngine()
        rule = make_rule(
            override_type=OverrideType.URL_REDIRECT,
            redirect_url="https://new-url.com/api",
        )
        action = engine.get_action(make_flow("http://test.com"), rule)
        assert action["type"] == "url_redirect"
        assert action["redirect_url"] == "https://new-url.com/api"

    def test_status_override_action(self):
        engine = OverrideEngine()
        rule = make_rule(
            override_type=OverrideType.RESPONSE_STATUS,
            response_status_override=404,
        )
        action = engine.get_action(make_flow("http://test.com"), rule)
        assert action["type"] == "response_status"
        assert action["status"] == 404

    def test_body_override_action(self):
        engine = OverrideEngine()
        rule = make_rule(
            override_type=OverrideType.RESPONSE_BODY,
            response_body_override='{"mock": true}',
        )
        action = engine.get_action(make_flow("http://test.com"), rule)
        assert action["type"] == "response_body"
        assert action["body"] == '{"mock": true}'

    def test_header_modify_action(self):
        engine = OverrideEngine()
        rule = make_rule(
            override_type=OverrideType.HEADER_MODIFY,
            request_headers_to_add={"X-Custom": "value"},
            request_headers_to_remove=["X-Unwanted"],
        )
        action = engine.get_action(make_flow("http://test.com"), rule)
        assert action["type"] == "header_modify"
        assert action["add_headers"] == {"X-Custom": "value"}
        assert action["remove_headers"] == ["X-Unwanted"]

    def test_latency_action(self):
        engine = OverrideEngine()
        rule = make_rule(
            override_type=OverrideType.LATENCY,
            latency_ms=1000,
        )
        action = engine.get_action(make_flow("http://test.com"), rule)
        assert action["type"] == "latency"
        assert action["latency_ms"] == 1000


class TestApplicableRules:
    """Test getting applicable rules for a URL."""

    def test_get_applicable_rules(self):
        engine = OverrideEngine()
        engine.load_rules([
            make_rule(name="rule1", pattern="*.example.com/*"),
            make_rule(name="rule2", pattern="*.google.com/*"),
        ])
        applicable = engine.get_applicable_rules_for_url("https://api.example.com/users", "GET")
        assert len(applicable) == 1
        assert applicable[0].name == "rule1"

    def test_empty_pattern_matches_all(self):
        engine = OverrideEngine()
        engine.load_rules([make_rule(name="catchall", pattern="")])
        applicable = engine.get_applicable_rules_for_url("https://anything.com/path", "GET")
        assert len(applicable) == 1

    def test_create_matcher(self):
        """Test the create_matcher factory function."""
        engine = OverrideEngine()
        engine.load_rules([make_rule(pattern="*.example.com/*", override_type=OverrideType.BLOCK)])

        matcher = engine.create_matcher()
        flow = make_flow("https://api.example.com/users")
        result = matcher(flow)
        assert result is not None
        assert result["type"] == "block"

        flow2 = make_flow("https://other.com/api")
        result2 = matcher(flow2)
        assert result2 is None

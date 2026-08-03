"""Override engine — matches HTTP requests against rules and applies modifications.

This is the "重点开发" (key feature) of prism. The engine:
1. Loads enabled rules from the database
2. Matches incoming HTTP flows against URL patterns (exact, prefix, glob, regex)
3. Returns override actions that the proxy core applies

Supports 7 override types:
  - url_redirect:    Rewrite request URL
  - header_modify:   Add/remove request headers
  - response_status: Change HTTP response status code
  - response_body:   Replace response body entirely
  - response_headers: Add/remove response headers
  - latency:         Inject artificial delay (ms)
  - block:           Drop the request entirely
"""

from __future__ import annotations

import fnmatch
import logging
import re
from typing import Dict, List, Optional

from mitmproxy.http import HTTPFlow

from .models import MatchType, OverrideRule, OverrideType

logger = logging.getLogger(__name__)


class OverrideEngine:
    """Matches HTTP flows against override rules and returns actions.

    Thread-compatible: all state is read-only after load_rules().
    """

    def __init__(self):
        self._rules: List[OverrideRule] = []
        self._compiled: Dict[str, re.Pattern] = {}  # cache compiled regex patterns

    def load_rules(self, rules: List[OverrideRule]) -> None:
        """Load/reload the active rule set.

        Call this whenever rules change in the database.
        """
        self._rules = [r for r in rules if r.enabled]
        self._compiled.clear()
        # Pre-compile regex patterns
        for rule in self._rules:
            if rule.match_type == MatchType.REGEX and rule.match_pattern:
                try:
                    self._compiled[rule.id] = re.compile(rule.match_pattern)
                except re.error as e:
                    logger.warning("Invalid regex in rule %s: %s", rule.id, e)

        logger.info("Loaded %d active override rules", len(self._rules))

    # ── Matching ────────────────────────────────────────────────────

    def match(self, flow: HTTPFlow) -> Optional[OverrideRule]:
        """Find the first matching rule for an HTTP flow.

        Returns the rule, or None if no rule matches.
        If multiple rules match, the first one (in load order) wins.
        """
        url = flow.request.pretty_url
        method = flow.request.method

        for rule in self._rules:
            if rule.match_method and rule.match_method.value != method:
                continue
            if self._url_matches(url, rule.match_type, rule.match_pattern, rule.id):
                return rule

        return None

    def _url_matches(self, url: str, match_type: MatchType, pattern: str, rule_id: str) -> bool:
        """Check if a URL matches a rule's pattern."""
        if not pattern:
            return True  # empty pattern = match all

        if match_type == MatchType.EXACT:
            return url == pattern
        elif match_type == MatchType.PREFIX:
            return url.startswith(pattern)
        elif match_type == MatchType.GLOB:
            return fnmatch.fnmatch(url, pattern)
        elif match_type == MatchType.REGEX:
            compiled = self._compiled.get(rule_id)
            if compiled:
                return bool(compiled.search(url))
            return False
        return False

    # ── Action Resolution ──────────────────────────────────────────

    def get_action(self, flow: HTTPFlow, rule: OverrideRule) -> dict:
        """Convert a matched rule into an action dict for the proxy core.

        Returns a dict that HaruCaptureAddon.request()/response() consumes.
        """
        action: dict = {
            "type": rule.override_type.value,
            "rule_id": rule.id,
            "rule_name": rule.name,
        }

        if rule.override_type == OverrideType.URL_REDIRECT and rule.redirect_url:
            action["redirect_url"] = rule.redirect_url

        elif rule.override_type == OverrideType.HEADER_MODIFY:
            action["add_headers"] = dict(rule.request_headers_to_add)
            action["remove_headers"] = list(rule.request_headers_to_remove)

        elif rule.override_type == OverrideType.RESPONSE_STATUS and rule.response_status_override:
            action["status"] = rule.response_status_override

        elif rule.override_type == OverrideType.RESPONSE_BODY:
            action["body"] = rule.response_body_override or ""

        elif rule.override_type == OverrideType.RESPONSE_HEADERS:
            action["add_headers"] = dict(rule.response_headers_to_add)
            action["remove_headers"] = list(rule.response_headers_to_remove)

        elif rule.override_type == OverrideType.LATENCY and rule.latency_ms:
            action["latency_ms"] = rule.latency_ms

        elif rule.override_type == OverrideType.BLOCK:
            action["block"] = True

        return action

    # ── Matching function for proxy_core ────────────────────────────

    def create_matcher(self):
        """Create a matcher function for HaruCaptureAddon.

        Returns a callable suitable as override_matcher that the proxy
        core uses for both request and response interception.
        """
        engine = self  # capture reference

        def matcher(flow: HTTPFlow) -> Optional[dict]:
            rule = engine.match(flow)
            if rule:
                return engine.get_action(flow, rule)
            return None

        return matcher

    def get_applicable_rules_for_url(self, url: str, method: str) -> List[OverrideRule]:
        """Get all rules that would match a given URL (for display/preview).

        Useful for the UI to show which rules apply to a specific request.
        """
        applicable = []
        for rule in self._rules:
            if rule.match_method and rule.match_method.value != method:
                continue
            if self._url_matches(url, rule.match_type, rule.match_pattern, rule.id):
                applicable.append(rule)
        return applicable

    @property
    def rule_count(self) -> int:
        return len(self._rules)

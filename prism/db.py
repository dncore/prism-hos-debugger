"""SQLite persistence layer for request log and override rules."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import AsyncGenerator, List, Optional

import aiosqlite

from .models import (
    CapturedRequest,
    HttpMethod,
    MatchType,
    OverrideRule,
    OverrideType,
)

DB_PATH = None  # set by init_db


_initialized: bool = False


async def init_db(path: str = ":memory:") -> None:
    """Initialize the database schema. Safe to call multiple times."""
    global DB_PATH, _initialized
    if _initialized and DB_PATH == path:
        return
    DB_PATH = path

    async with aiosqlite.connect(path) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("""
            CREATE TABLE IF NOT EXISTS requests (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                method TEXT NOT NULL,
                scheme TEXT DEFAULT 'http',
                request_headers TEXT DEFAULT '{}',
                request_body TEXT,
                request_body_size INTEGER DEFAULT 0,
                response_status INTEGER,
                response_headers TEXT DEFAULT '{}',
                response_body TEXT,
                response_body_size INTEGER DEFAULT 0,
                timestamp TEXT NOT NULL,
                dns_duration_ms REAL DEFAULT 0,
                connect_duration_ms REAL DEFAULT 0,
                tls_duration_ms REAL DEFAULT 0,
                ttfb_ms REAL DEFAULT 0,
                total_duration_ms REAL DEFAULT 0,
                is_https INTEGER DEFAULT 0,
                intercepted INTEGER DEFAULT 0,
                rule_id TEXT,
                error TEXT,
                remote_address TEXT DEFAULT '',
                content_type TEXT DEFAULT ''
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rules (
                id TEXT PRIMARY KEY,
                name TEXT DEFAULT '',
                enabled INTEGER DEFAULT 1,
                match_type TEXT DEFAULT 'glob',
                match_pattern TEXT DEFAULT '',
                match_method TEXT,
                override_type TEXT NOT NULL,
                redirect_url TEXT,
                request_headers_to_add TEXT DEFAULT '{}',
                request_headers_to_remove TEXT DEFAULT '[]',
                response_status_override INTEGER,
                response_body_override TEXT,
                response_headers_to_add TEXT DEFAULT '{}',
                response_headers_to_remove TEXT DEFAULT '[]',
                latency_ms INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        await db.commit()
    _initialized = True


# ── Requests ────────────────────────────────────────────────────────

def _row_to_request(row: aiosqlite.Row) -> CapturedRequest:
    """Convert a DB row to a CapturedRequest model."""
    return CapturedRequest(
        id=row["id"],
        url=row["url"],
        method=HttpMethod(row["method"]),
        scheme=row["scheme"],
        request_headers=json.loads(row["request_headers"]),
        request_body=row["request_body"],
        request_body_size=row["request_body_size"],
        response_status=row["response_status"],
        response_headers=json.loads(row["response_headers"]),
        response_body=row["response_body"],
        response_body_size=row["response_body_size"],
        timestamp=datetime.fromisoformat(row["timestamp"]),
        dns_duration_ms=row["dns_duration_ms"],
        connect_duration_ms=row["connect_duration_ms"],
        tls_duration_ms=row["tls_duration_ms"],
        ttfb_ms=row["ttfb_ms"],
        total_duration_ms=row["total_duration_ms"],
        is_https=bool(row["is_https"]),
        intercepted=bool(row["intercepted"]),
        rule_id=row["rule_id"],
        error=row["error"],
        remote_address=row["remote_address"],
        content_type=row["content_type"],
    )


async def insert_request(req: CapturedRequest) -> None:
    """Insert a captured request into the database."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO requests VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )""",
            (
                req.id,
                req.url,
                req.method.value,
                req.scheme,
                json.dumps(req.request_headers),
                req.request_body,
                req.request_body_size,
                req.response_status,
                json.dumps(req.response_headers),
                req.response_body,
                req.response_body_size,
                req.timestamp.isoformat(),
                req.dns_duration_ms,
                req.connect_duration_ms,
                req.tls_duration_ms,
                req.ttfb_ms,
                req.total_duration_ms,
                int(req.is_https),
                int(req.intercepted),
                req.rule_id,
                req.error,
                req.remote_address,
                req.content_type,
            ),
        )
        await db.commit()


async def get_request(request_id: str) -> Optional[CapturedRequest]:
    """Get a single request by ID."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM requests WHERE id = ?", (request_id,)
        )
        row = await cursor.fetchone()
        return _row_to_request(row) if row else None


async def list_requests(
    limit: int = 100,
    offset: int = 0,
    url_filter: Optional[str] = None,
    method_filter: Optional[str] = None,
) -> List[CapturedRequest]:
    """List captured requests with optional filtering."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT * FROM requests"
        params: list = []
        conditions: list = []

        if url_filter:
            conditions.append("url LIKE ?")
            params.append(f"%{url_filter}%")
        if method_filter:
            conditions.append("method = ?")
            params.append(method_filter.upper())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [_row_to_request(r) for r in rows]


async def count_requests(
    url_filter: Optional[str] = None,
    method_filter: Optional[str] = None,
) -> int:
    """Count requests with optional filtering."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT COUNT(*) as cnt FROM requests"
        params: list = []
        conditions: list = []

        if url_filter:
            conditions.append("url LIKE ?")
            params.append(f"%{url_filter}%")
        if method_filter:
            conditions.append("method = ?")
            params.append(method_filter.upper())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        cursor = await db.execute(query, params)
        row = await cursor.fetchone()
        return row["cnt"] if row else 0


async def clear_requests() -> None:
    """Delete all captured requests."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM requests")
        await db.commit()


# ── Rules ──────────────────────────────────────────────────────────

def _row_to_rule(row: aiosqlite.Row) -> OverrideRule:
    """Convert a DB row to an OverrideRule model."""
    return OverrideRule(
        id=row["id"],
        name=row["name"],
        enabled=bool(row["enabled"]),
        match_type=MatchType(row["match_type"]),
        match_pattern=row["match_pattern"],
        match_method=HttpMethod(row["match_method"]) if row["match_method"] else None,
        override_type=OverrideType(row["override_type"]),
        redirect_url=row["redirect_url"],
        request_headers_to_add=json.loads(row["request_headers_to_add"]),
        request_headers_to_remove=json.loads(row["request_headers_to_remove"]),
        response_status_override=row["response_status_override"],
        response_body_override=row["response_body_override"],
        response_headers_to_add=json.loads(row["response_headers_to_add"]),
        response_headers_to_remove=json.loads(row["response_headers_to_remove"]),
        latency_ms=row["latency_ms"],
        created_at=datetime.fromisoformat(row["created_at"]),
        updated_at=datetime.fromisoformat(row["updated_at"]),
    )


async def list_rules() -> List[OverrideRule]:
    """List all override rules."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM rules ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [_row_to_rule(r) for r in rows]


async def get_rule(rule_id: str) -> Optional[OverrideRule]:
    """Get a single rule by ID."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM rules WHERE id = ?", (rule_id,))
        row = await cursor.fetchone()
        return _row_to_rule(row) if row else None


async def create_rule(rule: OverrideRule) -> OverrideRule:
    """Create a new override rule."""
    rule.id = rule.id or str(uuid.uuid4())
    now = datetime.now().isoformat()
    rule.created_at = datetime.fromisoformat(now)
    rule.updated_at = datetime.fromisoformat(now)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO rules VALUES (
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            )""",
            (
                rule.id,
                rule.name,
                int(rule.enabled),
                rule.match_type.value,
                rule.match_pattern,
                rule.match_method.value if rule.match_method else None,
                rule.override_type.value,
                rule.redirect_url,
                json.dumps(rule.request_headers_to_add),
                json.dumps(rule.request_headers_to_remove),
                rule.response_status_override,
                rule.response_body_override,
                json.dumps(rule.response_headers_to_add),
                json.dumps(rule.response_headers_to_remove),
                rule.latency_ms,
                rule.created_at.isoformat(),
                rule.updated_at.isoformat(),
            ),
        )
        await db.commit()
    return rule


async def update_rule(rule_id: str, updates: dict) -> Optional[OverrideRule]:
    """Update an existing rule. Only changed fields are updated."""
    existing = await get_rule(rule_id)
    if not existing:
        return None

    # Apply updates to the model
    for key, value in updates.items():
        if hasattr(existing, key) and key not in ("id", "created_at", "updated_at"):
            setattr(existing, key, value)

    existing.updated_at = datetime.now()

    # Full replace in DB
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """UPDATE rules SET
                name=?, enabled=?, match_type=?, match_pattern=?, match_method=?,
                override_type=?, redirect_url=?,
                request_headers_to_add=?, request_headers_to_remove=?,
                response_status_override=?, response_body_override=?,
                response_headers_to_add=?, response_headers_to_remove=?,
                latency_ms=?, updated_at=?
            WHERE id=?""",
            (
                existing.name,
                int(existing.enabled),
                existing.match_type.value,
                existing.match_pattern,
                existing.match_method.value if existing.match_method else None,
                existing.override_type.value,
                existing.redirect_url,
                json.dumps(existing.request_headers_to_add),
                json.dumps(existing.request_headers_to_remove),
                existing.response_status_override,
                existing.response_body_override,
                json.dumps(existing.response_headers_to_add),
                json.dumps(existing.response_headers_to_remove),
                existing.latency_ms,
                existing.updated_at.isoformat(),
                rule_id,
            ),
        )
        await db.commit()
    return existing


async def delete_rule(rule_id: str) -> bool:
    """Delete a rule. Returns True if deleted, False if not found."""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM rules WHERE id = ?", (rule_id,))
        await db.commit()
        return cursor.rowcount > 0


async def toggle_rule(rule_id: str) -> Optional[OverrideRule]:
    """Toggle a rule's enabled state."""
    rule = await get_rule(rule_id)
    if not rule:
        return None
    return await update_rule(rule_id, {"enabled": not rule.enabled})


async def get_enabled_rules() -> List[OverrideRule]:
    """Get all enabled override rules."""
    rules = await list_rules()
    return [r for r in rules if r.enabled]

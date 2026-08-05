import type { CapturedRequest } from '@/types';

interface FilterToken {
  negate: boolean;
  key: 'method' | 'status' | 'type' | 'text';
  value: string;
}

/**
 * Parse a filter query string into structured tokens.
 *
 * Syntax:
 *   plain text         → URL substring match (all tokens ANDed)
 *   method:GET          → exact method
 *   method:GET,POST     → multi-method
 *   status:200          → exact status
 *   status:2xx          → range (2xx=200-299, 3xx=300-399, etc.)
 *   -status:404         → exclude matching (negate with - prefix)
 *   type:json           → content-type contains "json"
 *   type:fetch           → API calls (json/xml content-type)
 *   type:css|js|img|font|media|doc → content-type matching
 */
export function parseFilterQuery(query: string): FilterToken[] {
  if (!query.trim()) return [];

  const tokens: FilterToken[] = [];
  const parts = query.match(/(-?[a-z]+:(?:[a-z0-9,/+-]+|[^\s]+))|([^\s]+)/gi) || [];

  for (const part of parts) {
    const negate = part.startsWith('-');
    const clean = negate ? part.slice(1) : part;

    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0 && colonIdx < clean.length - 1) {
      const key = clean.slice(0, colonIdx).toLowerCase() as FilterToken['key'];
      const value = clean.slice(colonIdx + 1);
      if (key === 'method' || key === 'status' || key === 'type') {
        tokens.push({ negate, key, value });
        continue;
      }
    }

    tokens.push({ negate, key: 'text', value: clean });
  }

  return tokens;
}

const TYPE_MAP: Record<string, string[]> = {
  fetch: ['json', 'xml', 'x-www-form-urlencoded', 'application/x-www-form-urlencoded'],
  xhr: ['json', 'xml'],
  js: ['javascript', 'ecmascript'],
  css: ['css'],
  img: ['image/'],
  font: ['font/', 'woff', 'ttf', 'otf'],
  media: ['video/', 'audio/'],
  doc: ['html'],
};

function typeMatches(contentType: string, typeQuery: string): boolean {
  const ct = contentType.toLowerCase();
  const tq = typeQuery.toLowerCase();

  // Exact content-type substring match
  if (ct.includes(tq)) return true;

  // Known type categories
  const patterns = TYPE_MAP[tq];
  if (patterns) return patterns.some(p => ct.includes(p));

  return false;
}

function statusInRange(status: number | null, range: string): boolean {
  if (status === null) return false;
  const s = String(status);
  if (/^\dxx$/i.test(range)) {
    const prefix = range[0];
    return s.startsWith(prefix) && s.length === 3;
  }
  if (/^\d{3}$/.test(range)) {
    return s === range;
  }
  return false;
}

export function matchRequest(req: CapturedRequest, tokensOrQuery: FilterToken[] | string): boolean {
  const tokens = Array.isArray(tokensOrQuery) ? tokensOrQuery : parseFilterQuery(tokensOrQuery);
  if (!tokens.length) return true;

  return tokens.every(tok => {
    let match = false;

    switch (tok.key) {
      case 'method':
        match = tok.value.split(',').some(m => req.method.toUpperCase() === m.trim().toUpperCase());
        break;
      case 'status':
        match = tok.value.split(',').some(v => {
          if (/^\dxx$/i.test(v.trim())) return statusInRange(req.response_status, v.trim());
          if (/^\d{3}$/.test(v.trim())) return String(req.response_status) === v.trim();
          return false;
        });
        break;
      case 'type':
        match = tok.value.split(',').some(v => typeMatches(req.content_type, v.trim()));
        break;
      case 'text':
        match = req.url.toLowerCase().includes(tok.value.toLowerCase());
        break;
    }

    return tok.negate ? !match : match;
  });
}

/** Pre-set quick filter definitions shown as toggle buttons */
export const QUICK_FILTERS = [
  { label: 'XHR', query: 'type:fetch' },
  { label: 'JS', query: 'type:js' },
  { label: 'CSS', query: 'type:css' },
  { label: 'Img', query: 'type:img' },
  { label: 'Font', query: 'type:font' },
] as const;


import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { CapturedRequest, OverrideRule } from '@/types';

interface Props {
  request: CapturedRequest | null;
  toast?: (msg: string, type?: string) => void;
  onRulesChanged?: () => void;
}

type Tab = 'headers' | 'payload' | 'preview' | 'response' | 'timing' | 'override';

const OVERRIDE_LABELS: Record<string, string> = {
  block: 'Block',
  url_redirect: 'Redirect',
  response_body: 'Mock Body',
  response_status: 'Status',
  latency: 'Latency',
};

const TYPE_COLORS: Record<string, string> = {
  block: 'bg-red-500/10 text-red-500',
  url_redirect: 'bg-orange-500/10 text-orange-500',
  response_body: 'bg-blue-500/10 text-blue-500',
  response_status: 'bg-yellow-500/10 text-yellow-500',
  latency: 'bg-purple-500/10 text-purple-500',
};

const TAB_KEYS: Tab[] = ['headers', 'payload', 'preview', 'response', 'timing', 'override'];

export function DetailPanel({ request, toast, onRulesChanged }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('headers');

  const labelMap: Record<Tab, string> = {
    headers: t('tab.headers'),
    payload: t('tab.payload'),
    preview: t('tab.preview'),
    response: t('tab.response'),
    timing: t('tab.timing'),
    override: t('tab.override'),
  };

  if (!request) {
    return (
      <div className="h-full flex flex-col min-w-0 bg-background">
        <div className="flex border-b border-border bg-secondary/30">
          {TAB_KEYS.map(k => <TabBtn key={k} label={labelMap[k]} active={false} onClick={() => {}} />)}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <span className="text-sm">{t('detail.select')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-w-0 bg-background">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/30 flex-shrink-0">
        <span className={cn("text-sm font-semibold flex-1 truncate", request.response_status && request.response_status >= 400 && 'text-red-500')}>
          {request.method} {request.url}
        </span>
        <span className={cn("text-sm font-bold", request.response_status && `text-status-${String(request.response_status)[0]}`)}>
          {request.response_status || '---'} {statusText(request.response_status)}
        </span>
        {request.intercepted && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500 text-white font-medium">{t('detail.override_tag')}</span>
        )}
      </div>
      <div className="flex border-b border-border bg-secondary/30">
        {TAB_KEYS.map(k => <TabBtn key={k} label={labelMap[k]} active={tab === k} onClick={() => setTab(k)} />)}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'headers' && <HeadersView request={request} />}
        {tab === 'payload' && <PayloadView request={request} />}
        {tab === 'preview' && <PreviewView request={request} />}
        {tab === 'response' && <ResponseView request={request} />}
        {tab === 'timing' && <TimingView request={request} />}
        {tab === 'override' && (
          <OverrideTab request={request} toast={toast} onRulesChanged={onRulesChanged} />
        )}
      </div>
    </div>
  );
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn("px-4 py-1.5 text-xs border-r border-border bg-transparent cursor-pointer transition-colors",
        active ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  );
}

// ── Override Tab ──────────────────────────────────────────────────

function OverrideTab({
  request,
  toast,
  onRulesChanged,
}: {
  request: CapturedRequest;
  toast?: (msg: string, type?: string) => void;
  onRulesChanged?: () => void;
}) {
  const { t } = useI18n();
  const [rules, setRules] = useState<OverrideRule[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newType, setNewType] = useState<string | null>(null);
  const msg = (msg: string, type = 'info') => toast?.(msg, type);

  const refresh = useCallback(() => {
    api.rules().then(setRules).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const matchingRules = rules.filter((r) => {
    const pattern = r.match_pattern;
    if (!pattern) return false;
    const url = request.url;
    if (r.match_type === 'prefix') return url.startsWith(pattern);
    if (r.match_type === 'exact') return url === pattern;
    if (r.match_type === 'glob') {
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return re.test(url);
    }
    if (r.match_type === 'regex') {
      try { return new RegExp(pattern).test(url); } catch { return false; }
    }
    return false;
  });

  const otherRules = rules.filter((r) => !matchingRules.includes(r));

  const toggleRule = async (id: string) => {
    try { await api.toggleRule(id); refresh(); onRulesChanged?.(); } catch (e: any) { msg(e.message, 'error'); }
  };

  const deleteRule = async (id: string) => {
    try { await api.deleteRule(id); refresh(); onRulesChanged?.(); msg(t('override.deleted'), 'info'); } catch (e: any) { msg(e.message, 'error'); }
  };

  const done = () => { setEditingId(null); setNewType(null); refresh(); onRulesChanged?.(); };

  const derivedPattern = request.url.replace(/\?.*$/, '');

  const quickLabels: Record<string, string> = {
    block: t('override.block'),
    url_redirect: t('override.redirect'),
    response_body: t('override.mock_body'),
    response_status: t('override.status'),
    latency: t('override.latency'),
  };

  return (
    <div className="space-y-4">
      {/* Quick Override */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-semibold">{t('override.quick')}</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(quickLabels).map(([k, label]) => (
            <button
              key={k}
              className="px-2 py-1 rounded text-[11px] border border-border hover:bg-accent transition-colors"
              onClick={() => setNewType(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {newType && (
          <RuleEditorInline
            rule={null}
            presetType={newType}
            presetPattern={derivedPattern}
            onSave={done}
            onCancel={() => setNewType(null)}
            toast={msg}
          />
        )}
      </div>

      {/* Matching Rules */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-semibold">
          {t('override.matching', { n: matchingRules.length })}
        </p>
        {matchingRules.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('override.no_match')}</p>
        ) : (
          <div className="space-y-0.5">
            {matchingRules.map((r) =>
              editingId === r.id ? (
                <RuleEditorInline key={r.id} rule={r} onSave={done} onCancel={() => setEditingId(null)} toast={msg} />
              ) : (
                <RuleRow
                  key={r.id}
                  rule={r}
                  onEdit={() => setEditingId(r.id)}
                  onToggle={() => toggleRule(r.id)}
                  onDelete={() => deleteRule(r.id)}
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* All Other Rules */}
      {otherRules.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2 font-semibold">
            {t('override.all', { n: otherRules.length })}
          </p>
          <div className="space-y-0.5">
            {otherRules.map((r) =>
              editingId === r.id ? (
                <RuleEditorInline key={r.id} rule={r} onSave={done} onCancel={() => setEditingId(null)} toast={msg} />
              ) : (
                <RuleRow
                  key={r.id}
                  rule={r}
                  onEdit={() => setEditingId(r.id)}
                  onToggle={() => toggleRule(r.id)}
                  onDelete={() => deleteRule(r.id)}
                />
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: OverrideRule;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-transparent hover:border-border hover:bg-accent/50 transition-colors">
      <button
        className={cn(
          'w-7 h-4 rounded-full transition-colors relative flex-shrink-0',
          rule.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
        onClick={onToggle}
      >
        <span
          className={cn(
            'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
            rule.enabled ? 'left-3.5' : 'left-0.5',
          )}
        />
      </button>
      <span className={cn('px-1 py-0.5 rounded text-[10px] flex-shrink-0', TYPE_COLORS[rule.override_type] || 'bg-muted text-muted-foreground')}>
        {OVERRIDE_LABELS[rule.override_type] || rule.override_type}
      </span>
      <span className="font-medium truncate flex-1">{rule.name || 'Untitled'}</span>
      <span className="text-muted-foreground font-mono text-[10px] truncate max-w-[120px]">{rule.match_pattern}</span>
      <button className="text-muted-foreground hover:text-foreground p-0.5 flex-shrink-0" onClick={onEdit}>
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </button>
      <button className="text-muted-foreground hover:text-red-500 p-0.5 flex-shrink-0" onClick={onDelete}>
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>
    </div>
  );
}

function RuleEditorInline({
  rule,
  presetType,
  presetPattern,
  onSave,
  onCancel,
  toast,
}: {
  rule: OverrideRule | null;
  presetType?: string;
  presetPattern?: string;
  onSave: () => void;
  onCancel: () => void;
  toast: (msg: string, type?: string) => void;
}) {
  const { t } = useI18n();
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name || '');
  const [otype, setOtype] = useState(presetType || rule?.override_type || 'block');
  const [pattern, setPattern] = useState(rule?.match_pattern || presetPattern || '');
  const [redirect, setRedirect] = useState(rule?.redirect_url || '');
  const [body, setBody] = useState(rule?.response_body_override || '');
  const [status, setStatus] = useState(rule?.response_status_override?.toString() || (presetType === 'response_body' ? '200' : ''));
  const [latency, setLatency] = useState(rule?.latency_ms?.toString() || '');
  const [saving, setSaving] = useState(false);

  const ruleLabels: Record<string, string> = {
    block: t('rule.block'),
    url_redirect: t('rule.redirect'),
    response_body: t('rule.mock_body'),
    response_status: t('rule.status'),
    latency: t('rule.latency'),
    header_modify: t('rule.header_modify'),
    response_headers: t('rule.response_headers'),
  };

  const save = async () => {
    if (!pattern.trim()) return;
    setSaving(true);
    const d: any = {
      name: name || (isEdit ? rule!.name : `${ruleLabels[otype] || otype} — ${pattern}`),
      override_type: otype,
      match_type: 'prefix',
      match_pattern: pattern,
      match_method: null,
    };
    if (otype === 'response_body') d.response_body_override = body;
    if (otype === 'url_redirect') d.redirect_url = redirect;
    if (otype === 'response_status') d.response_status_override = parseInt(status) || null;
    if (otype === 'latency') d.latency_ms = parseInt(latency) || 0;
    try {
      if (isEdit) await api.updateRule(rule!.id, d);
      else await api.createRule(d);
      onSave();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-2 border border-border rounded bg-muted/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{isEdit ? t('override.edit_rule') : t('override.new_rule')}</span>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <select
        value={otype}
        onChange={(e) => setOtype(e.target.value)}
        disabled={!!presetType}
        className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
      >
        {Object.entries(ruleLabels).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('override.name_placeholder')}
        className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <input
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
        placeholder={t('override.pattern_placeholder')}
        className="w-full px-2 py-1 rounded text-xs border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {otype === 'url_redirect' && (
        <input
          value={redirect}
          onChange={(e) => setRedirect(e.target.value)}
          placeholder={t('override.redirect_placeholder')}
          className="w-full px-2 py-1 rounded text-xs border border-border bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )}
      {otype === 'response_body' && (
        <>
          <input
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder={t('override.status_placeholder')}
            type="number"
            className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('override.body_placeholder')}
            rows={4}
            className="w-full px-2 py-1 rounded text-xs border border-border bg-background font-mono resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </>
      )}
      {otype === 'response_status' && (
        <input
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder={t('override.status_placeholder')}
          type="number"
          className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )}
      {otype === 'latency' && (
        <input
          value={latency}
          onChange={(e) => setLatency(e.target.value)}
          placeholder={t('override.latency_placeholder')}
          type="number"
          className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )}
      <div className="flex justify-end gap-1.5 pt-1">
        <button
          onClick={onCancel}
          className="px-2 py-1 rounded text-[11px] border border-border hover:bg-accent transition-colors"
        >
          {t('override.cancel')}
        </button>
        <button
          onClick={save}
          disabled={saving || !pattern.trim()}
          className="px-2 py-1 rounded text-[11px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saving ? t('override.saving') : isEdit ? t('override.update') : t('override.save')}
        </button>
      </div>
    </div>
  );
}

// ── Existing Views ──────────────────────────────────────────────────

function statusText(c: number | null) {
  if (!c) return '';
  const t: Record<number,string> = {200:'OK',201:'Created',204:'No Content',301:'Moved',302:'Found',304:'Not Modified',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',500:'Server Error',502:'Bad Gateway',503:'Unavailable'};
  return t[c] || '';
}

function HeadersTable({ headers, label }: { headers: Record<string,string>; label: string }) {
  const { t } = useI18n();
  const entries = Object.entries(headers);
  if (!entries.length) return <p className="text-muted-foreground text-xs my-3">{t('headers.empty', { label })}</p>;
  return (
    <div>
      <p className="text-muted-foreground text-xs my-3 font-semibold">{label}</p>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="text-left text-muted-foreground"><th className="px-2 py-1 border-b border-border font-medium">Name</th><th className="px-2 py-1 border-b border-border font-medium">Value</th></tr></thead>
        <tbody>
          {entries.map(([k,v]) => (
            <tr key={k} className="border-b border-border">
              <td className="px-2 py-1 text-purple-500 font-mono w-[30%] align-top break-all">{k}</td>
              <td className="px-2 py-1 font-mono align-top break-all">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeadersView({ request: r }: { request: CapturedRequest }) {
  const { t } = useI18n();
  return (
    <div>
      <HeadersTable headers={r.request_headers} label={t('headers.request')} />
      <hr className="border-border my-3" />
      <HeadersTable headers={r.response_headers} label={t('headers.response')} />
      <p className="text-muted-foreground text-[11px] mt-2">{t('headers.remote', { addr: r.remote_address || 'unknown' })}</p>
    </div>
  );
}

function PayloadView({ request: r }: { request: CapturedRequest }) {
  const { t } = useI18n();
  return (
    <div>
      <p className="text-muted-foreground text-xs mb-2 font-semibold">{t('payload.request_body')}</p>
      {r.request_body ? <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md max-h-[calc(100vh-250px)] overflow-y-auto">{r.request_body}</pre> : <p className="text-muted-foreground text-xs">{t('payload.none')}</p>}
    </div>
  );
}

function PreviewView({ request: r }: { request: CapturedRequest }) {
  const { t } = useI18n();
  const b = r.response_body;
  if (!b) return <p className="text-muted-foreground text-xs">{t('detail.no_body')}</p>;
  if ((r.content_type || '').includes('json')) {
    try { return <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md">{JSON.stringify(JSON.parse(b), null, 2)}</pre>; } catch {}
  }
  return <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md max-h-[calc(100vh-250px)] overflow-y-auto">{b}</pre>;
}

function ResponseView({ request: r }: { request: CapturedRequest }) {
  const { t } = useI18n();
  return (
    <div>
      <HeadersTable headers={r.response_headers} label={t('headers.response')} />
      {r.response_body && (
        <div>
          <p className="text-muted-foreground text-xs my-3 font-semibold">{t('response.body_size', { n: r.response_body_size })}</p>
          <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md max-h-[calc(100vh-300px)] overflow-y-auto">{r.response_body}</pre>
        </div>
      )}
    </div>
  );
}

function TimingView({ request: r }: { request: CapturedRequest }) {
  const { t } = useI18n();
  const total = r.total_duration_ms || 0;
  const max = Math.max(total, 1);
  const segs = [
    { l: t('timing.dns'), ms: r.dns_duration_ms || 0, c: 'bg-green-600' },
    { l: t('timing.tcp'), ms: r.connect_duration_ms || 0, c: 'bg-orange-500' },
    { l: t('timing.tls'), ms: r.tls_duration_ms || 0, c: 'bg-purple-500' },
    { l: t('timing.ttfb'), ms: r.ttfb_ms || 0, c: 'bg-emerald-500' },
    { l: t('timing.download'), ms: Math.max(0, total - (r.ttfb_ms || 0)), c: 'bg-blue-500' },
  ];

  let left = 0;
  return (
    <div>
      {segs.map(s => {
        if (s.ms <= 0) return null;
        const w = Math.max((s.ms / max) * 100, 0.5);
        const el = (
          <div key={s.l} className="flex items-center gap-2 py-1 text-xs">
            <span className="w-20 text-muted-foreground">{s.l}</span>
            <span className="w-16 text-right font-mono">{s.ms.toFixed(1)}ms</span>
            <div className="flex-1 h-3 bg-secondary rounded-sm relative overflow-hidden">
              <div className={`absolute h-full ${s.c} rounded-sm`} style={{ left: `${left}%`, width: `${w}%` }} />
            </div>
          </div>
        );
        left += w;
        return el;
      })}
      {!total && <p className="text-muted-foreground text-xs mt-2">{t('detail.no_timing')}</p>}
      <p className="text-muted-foreground text-[11px] mt-4">{r.timestamp} · {r.is_https ? 'HTTPS' : 'HTTP'} · {r.intercepted ? t('detail.override') : ''}</p>
    </div>
  );
}

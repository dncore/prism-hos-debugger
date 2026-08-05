import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import type { OverrideRule } from '@/types';

const OVERRIDE_LABELS: Record<string, string> = {
  block: 'Block Request',
  url_redirect: 'Redirect URL',
  response_body: 'Mock Response Body',
  response_status: 'Modify Status Code',
  latency: 'Add Latency',
  header_modify: 'Modify Request Headers',
  response_headers: 'Modify Response Headers',
};

const MATCH_LABELS: Record<string, string> = {
  prefix: 'URL Prefix',
  glob: 'Wildcard',
  regex: 'Regex',
  exact: 'Exact URL',
};

const TYPE_COLORS: Record<string, string> = {
  block: 'bg-red-500/10 text-red-500 border-red-500/20',
  url_redirect: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  response_body: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  response_status: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  latency: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  header_modify: 'bg-green-500/10 text-green-500 border-green-500/20',
  response_headers: 'bg-cyan-500/10 text-cyan-500 border-cyan-500/20',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onRulesChanged: () => void;
  toast: (msg: string, type?: string) => void;
}

export function RulesPopover({ open, onClose, onRulesChanged, toast }: Props) {
  const { t } = useI18n();
  const [rules, setRules] = useState<OverrideRule[]>([]);
  const [editing, setEditing] = useState<OverrideRule | null>(null);
  const [showNew, setShowNew] = useState(false);

  const refresh = useCallback(() => {
    api.rules().then(setRules).catch(() => {});
  }, []);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  if (!open) return null;

  const deleteRule = async (id: string) => {
    try {
      await api.deleteRule(id);
      refresh();
      onRulesChanged();
      toast(t('override.deleted'), 'info');
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  const toggleRule = async (id: string) => {
    try {
      await api.toggleRule(id);
      refresh();
      onRulesChanged();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="absolute top-full right-0 mt-1 z-50 w-80 border border-border rounded-md shadow-lg flex flex-col max-h-80"
        style={{ background: 'hsl(var(--card))' }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary/30">
          <span className="text-xs font-semibold">{t('override.title')}</span>
          <button
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            onClick={() => { setEditing(null); setShowNew(true); }}
          >
            <Plus className="w-3 h-3" /> {t('override.save')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {rules.length === 0 && !showNew && (
            <p className="text-muted-foreground text-xs p-2 text-center">{t('override.no_rules')}</p>
          )}

          {showNew && (
            <RulesEditorInline
              rule={null}
              onSave={() => { setShowNew(false); refresh(); onRulesChanged(); }}
              onCancel={() => setShowNew(false)}
              toast={toast}
            />
          )}

          {rules.map((r) =>
            editing?.id === r.id ? (
              <RulesEditorInline
                key={r.id}
                rule={r}
                onSave={() => { setEditing(null); refresh(); onRulesChanged(); }}
                onCancel={() => setEditing(null)}
                toast={toast}
              />
            ) : (
              <div
                key={r.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border border-transparent hover:border-border hover:bg-accent/50 transition-colors"
              >
                <button
                  className={cn(
                    'w-7 h-4 rounded-full transition-colors relative flex-shrink-0',
                    r.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
                  )}
                  onClick={() => toggleRule(r.id)}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all',
                      r.enabled ? 'left-3.5' : 'left-0.5',
                    )}
                  />
                </button>
                <span
                  className={cn(
                    'px-1 py-0.5 rounded text-[10px] border flex-shrink-0',
                    TYPE_COLORS[r.override_type] || 'bg-muted text-muted-foreground',
                  )}
                >
                  {OVERRIDE_LABELS[r.override_type] || r.override_type}
                </span>
                <span className="font-medium truncate flex-1">{r.name || 'Untitled'}</span>
                <button
                  className="text-muted-foreground hover:text-foreground p-0.5 flex-shrink-0"
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  className="text-muted-foreground hover:text-red-500 p-0.5 flex-shrink-0"
                  onClick={() => deleteRule(r.id)}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ),
          )}
        </div>
      </div>
    </>
  );
}

function RulesEditorInline({
  rule,
  onSave,
  onCancel,
  toast,
}: {
  rule: OverrideRule | null;
  onSave: () => void;
  onCancel: () => void;
  toast: (msg: string, type?: string) => void;
}) {
  const { t } = useI18n();
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name || '');
  const [otype, setOtype] = useState(rule?.override_type || 'block');
  const [pattern, setPattern] = useState(rule?.match_pattern || '');
  const [redirect, setRedirect] = useState(rule?.redirect_url || '');
  const [body, setBody] = useState(rule?.response_body_override || '');
  const [status, setStatus] = useState(rule?.response_status_override?.toString() || '');
  const [latency, setLatency] = useState(rule?.latency_ms?.toString() || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const d: any = {
      name: name || (isEdit ? rule!.name : 'Untitled'),
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
          <X className="w-3 h-3" />
        </button>
      </div>
      <select
        value={otype}
        onChange={(e) => setOtype(e.target.value)}
        className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {Object.entries(OVERRIDE_LABELS).map(([k, v]) => (
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
            className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('override.body_placeholder')}
            rows={3}
            className="w-full px-2 py-1 rounded text-xs border border-border bg-background font-mono resize-y focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </>
      )}
      {otype === 'response_status' && (
        <input
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder={t('override.status_placeholder')}
          className="w-full px-2 py-1 rounded text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      )}
      {otype === 'latency' && (
        <input
          value={latency}
          onChange={(e) => setLatency(e.target.value)}
          placeholder={t('override.latency_placeholder')}
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

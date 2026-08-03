import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { OverrideRule } from '@/types';

const OVERRIDE_TYPES = ['url_redirect','header_modify','response_status','response_body','response_headers','latency','block'];
const MATCH_TYPES = ['glob','regex','prefix','exact'];
const METHODS = ['','GET','POST','PUT','PATCH','DELETE','HEAD'];

export function OverridePanel({ toast }: { toast: (msg: string, type?: string) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [rules, setRules] = useState<OverrideRule[]>([]);
  const [editing, setEditing] = useState<OverrideRule | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => { api.rules().then(setRules).catch(() => {}); }, []);

  const refresh = () => { api.rules().then(setRules).catch(() => {}); };

  const toggleRule = async (id: string) => {
    try { await api.toggleRule(id); refresh(); } catch (e: any) { toast(e.message, 'error'); }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await api.deleteRule(id); refresh(); toast('Deleted', 'info'); } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="border-t border-border flex flex-col flex-shrink-0" style={{ maxHeight: '35%', background: 'hsl(var(--card))' }}>
      <div className="flex items-center gap-2 px-3.5 py-1.5 cursor-pointer flex-shrink-0 bg-secondary/30 border-b border-border" onClick={() => setCollapsed(!collapsed)}>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", collapsed && '-rotate-90')} />
        <span className="font-semibold text-sm">Override Rules</span>
        <button
          className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          onClick={e => { e.stopPropagation(); setEditing(null); setShowEditor(true); }}
        >
          <Plus className="w-3 h-3" /> Add Rule
        </button>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-2">
          {rules.length ? rules.map(r => (
            <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md mb-1 bg-muted/50 border border-border hover:border-foreground/20 transition-colors text-xs">
              <button
                className={cn("w-7 h-4 rounded-full transition-colors relative flex-shrink-0", r.enabled ? 'bg-primary' : 'bg-muted-foreground/30')}
                onClick={() => toggleRule(r.id)}
              >
                <span className={cn("absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all", r.enabled ? 'left-3.5' : 'left-0.5')} />
              </button>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-orange-500 font-medium flex-shrink-0">{r.override_type}</span>
              <span className="font-medium min-w-[60px]">{r.name || 'Untitled'}</span>
              <span className="text-muted-foreground font-mono flex-1 truncate">{r.match_type}:{r.match_pattern}</span>
              <button className="text-muted-foreground hover:text-foreground p-0.5" onClick={() => { setEditing(r); setShowEditor(true); }}><Pencil className="w-3 h-3" /></button>
              <button className="text-muted-foreground hover:text-red-500 p-0.5" onClick={() => deleteRule(r.id)}><Trash2 className="w-3 h-3" /></button>
            </div>
          )) : <p className="text-muted-foreground text-xs p-2">No override rules</p>}
        </div>
      )}
      {showEditor && <RuleEditor rule={editing} onClose={() => setShowEditor(false)} onSaved={refresh} toast={toast} />}
    </div>
  );
}

function RuleEditor({ rule, onClose, onSaved, toast }: { rule: OverrideRule | null; onClose: () => void; onSaved: () => void; toast: (msg: string, type?: string) => void }) {
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name || '');
  const [otype, setOtype] = useState(rule?.override_type || 'block');
  const [mtype, setMtype] = useState(rule?.match_type || 'glob');
  const [pattern, setPattern] = useState(rule?.match_pattern || '');
  const [method, setMethod] = useState(rule?.match_method || '');
  const [body, setBody] = useState(rule?.response_body_override || '');
  const [redirect, setRedirect] = useState(rule?.redirect_url || '');
  const [status, setStatus] = useState(rule?.response_status_override?.toString() || '');
  const [latency, setLatency] = useState(rule?.latency_ms?.toString() || '');

  const save = async () => {
    const d: any = { name, override_type: otype, match_type: mtype, match_pattern: pattern, match_method: method || null };
    if (otype === 'response_body') d.response_body_override = body;
    if (otype === 'url_redirect') d.redirect_url = redirect;
    if (otype === 'response_status') d.response_status_override = parseInt(status) || null;
    if (otype === 'latency') d.latency_ms = parseInt(latency) || 0;
    try {
      if (isEdit) { await api.updateRule(rule!.id, d); toast('Updated', 'success'); }
      else { await api.createRule(d); toast('Created', 'success'); }
      onSaved(); onClose();
    } catch (e: any) { toast(e.message, 'error'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="border border-border rounded-lg w-[520px] max-h-[80vh] overflow-y-auto shadow-xl" style={{background:'hsl(var(--card))'}}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-sm">{isEdit ? 'Edit' : 'New'} Rule</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-0.5"><Trash2 className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div><label className="text-xs text-muted-foreground">Name</label><input value={name} onChange={e => setName(e.target.value)} className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary" /></div>
          <div className="flex gap-3">
            <div className="flex-1"><label className="text-xs text-muted-foreground">Type</label><select value={otype} onChange={e => setOtype(e.target.value)} className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background">{OVERRIDE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div className="flex-1"><label className="text-xs text-muted-foreground">Match</label><select value={mtype} onChange={e => setMtype(e.target.value)} className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background">{MATCH_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <div><label className="text-xs text-muted-foreground">Pattern</label><input value={pattern} onChange={e => setPattern(e.target.value)} placeholder="*.api.example.com/**" className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary" /></div>
          <div><label className="text-xs text-muted-foreground">Method</label><select value={method} onChange={e => setMethod(e.target.value)} className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background">{METHODS.map(m => <option key={m} value={m}>{m || 'All'}</option>)}</select></div>
          {otype === 'response_body' && <div><label className="text-xs text-muted-foreground">Response Body</label><textarea value={body} onChange={e => setBody(e.target.value)} className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background font-mono min-h-[80px] resize-y focus:outline-none focus:ring-1 focus:ring-primary" /></div>}
          {otype === 'url_redirect' && <div><label className="text-xs text-muted-foreground">Redirect URL</label><input value={redirect} onChange={e => setRedirect(e.target.value)} className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary" /></div>}
          {otype === 'response_status' && <div><label className="text-xs text-muted-foreground">Status Code</label><input type="number" value={status} onChange={e => setStatus(e.target.value)} placeholder="200" className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary" /></div>}
          {otype === 'latency' && <div><label className="text-xs text-muted-foreground">Latency (ms)</label><input type="number" value={latency} onChange={e => setLatency(e.target.value)} placeholder="500" className="w-full mt-1 px-2 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary" /></div>}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-xs border border-border hover:bg-accent transition-colors">Cancel</button>
          <button onClick={save} className="px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity">{isEdit ? 'Update' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
}

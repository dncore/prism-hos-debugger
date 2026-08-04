import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CapturedRequest } from '@/types';

interface Props { request: CapturedRequest | null; }

type Tab = 'headers' | 'payload' | 'preview' | 'response' | 'timing';

export function DetailPanel({ request }: Props) {
  const [tab, setTab] = useState<Tab>('headers');

  if (!request) {
    return (
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <div className="flex border-b border-border bg-secondary/30">
          {TABS.map(t => <TabBtn key={t} name={t} active={false} onClick={() => {}} />)}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Select a request</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/30 flex-shrink-0">
        <span className={cn("text-sm font-semibold flex-1 truncate", request.response_status && request.response_status >= 400 && 'text-red-500')}>
          {request.method} {request.url}
        </span>
        <span className={cn("text-sm font-bold", request.response_status && `text-status-${String(request.response_status)[0]}`)}>
          {request.response_status || '---'} {statusText(request.response_status)}
        </span>
        {request.intercepted && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500 text-white font-medium">OVERRIDE</span>
        )}
      </div>
      <div className="flex border-b border-border bg-secondary/30">
        {TABS.map(t => <TabBtn key={t} name={t} active={tab === t} onClick={() => setTab(t)} />)}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'headers' && <HeadersView request={request} />}
        {tab === 'payload' && <PayloadView request={request} />}
        {tab === 'preview' && <PreviewView request={request} />}
        {tab === 'response' && <ResponseView request={request} />}
        {tab === 'timing' && <TimingView request={request} />}
      </div>
    </div>
  );
}

const TABS: Tab[] = ['headers', 'payload', 'preview', 'response', 'timing'];

function TabBtn({ name, active, onClick }: { name: Tab; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn("px-4 py-1.5 text-xs border-r border-border bg-transparent cursor-pointer transition-colors",
        active ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      {name.charAt(0).toUpperCase() + name.slice(1)}
    </button>
  );
}

function statusText(c: number | null) {
  if (!c) return '';
  const t: Record<number,string> = {200:'OK',201:'Created',204:'No Content',301:'Moved',302:'Found',304:'Not Modified',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',500:'Server Error',502:'Bad Gateway',503:'Unavailable'};
  return t[c] || '';
}

function HeadersTable({ headers, label }: { headers: Record<string,string>; label: string }) {
  const entries = Object.entries(headers);
  if (!entries.length) return <p className="text-muted-foreground text-xs my-3">{label}: (empty)</p>;
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
  return (
    <div>
      <HeadersTable headers={r.request_headers} label="Request Headers" />
      <hr className="border-border my-3" />
      <HeadersTable headers={r.response_headers} label="Response Headers" />
      <p className="text-muted-foreground text-[11px] mt-2">Remote: {r.remote_address || 'unknown'}</p>
    </div>
  );
}

function PayloadView({ request: r }: { request: CapturedRequest }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs mb-2 font-semibold">Request Body</p>
      {r.request_body ? <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md max-h-[calc(100vh-250px)] overflow-y-auto">{r.request_body}</pre> : <p className="text-muted-foreground text-xs">None</p>}
    </div>
  );
}

function PreviewView({ request: r }: { request: CapturedRequest }) {
  const b = r.response_body;
  if (!b) return <p className="text-muted-foreground text-xs">No response body</p>;
  if ((r.content_type || '').includes('json')) {
    try { return <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md">{JSON.stringify(JSON.parse(b), null, 2)}</pre>; } catch {}
  }
  return <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md max-h-[calc(100vh-250px)] overflow-y-auto">{b}</pre>;
}

function ResponseView({ request: r }: { request: CapturedRequest }) {
  return (
    <div>
      <HeadersTable headers={r.response_headers} label="Response Headers" />
      {r.response_body && (
        <div>
          <p className="text-muted-foreground text-xs my-3 font-semibold">Body ({r.response_body_size} bytes)</p>
          <pre className="font-mono text-xs whitespace-pre-wrap break-all bg-muted p-3 rounded-md max-h-[calc(100vh-300px)] overflow-y-auto">{r.response_body}</pre>
        </div>
      )}
    </div>
  );
}

function TimingView({ request: r }: { request: CapturedRequest }) {
  const total = r.total_duration_ms || 0;
  const max = Math.max(total, 1);
  const segs = [
    { l: 'DNS', ms: r.dns_duration_ms || 0, c: 'bg-green-600' },
    { l: 'TCP', ms: r.connect_duration_ms || 0, c: 'bg-orange-500' },
    { l: 'TLS', ms: r.tls_duration_ms || 0, c: 'bg-purple-500' },
    { l: 'TTFB', ms: r.ttfb_ms || 0, c: 'bg-emerald-500' },
    { l: 'Download', ms: Math.max(0, total - (r.ttfb_ms || 0)), c: 'bg-blue-500' },
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
      {!total && <p className="text-muted-foreground text-xs mt-2">No timing data</p>}
      <p className="text-muted-foreground text-[11px] mt-4">{r.timestamp} • {r.is_https ? 'HTTPS' : 'HTTP'} • {r.intercepted ? 'Override' : ''}</p>
    </div>
  );
}

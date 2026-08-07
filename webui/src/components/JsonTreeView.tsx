import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface Props {
  data: unknown;
}

export function JsonTreeView({ data }: Props) {
  const [copied, setCopied] = useState(false);

  const copyAll = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [data]);

  return (
    <div className="font-mono text-xs">
      <div className="flex items-center justify-between mb-1 px-1">
        <span className="text-muted-foreground text-[10px]">{} {countNodes(data)} keys</span>
        <button
          onClick={copyAll}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="bg-muted rounded-md p-2 overflow-auto max-h-[calc(100vh-250px)]">
        <JsonNode value={data} depth={0} path="$" />
      </div>
    </div>
  );
}

function countNodes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length + value.reduce((s, v) => s + countNodes(v), 0);
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length + entries.reduce((s, [, v]) => s + countNodes(v), 0);
  }
  return 0;
}

function JsonNode({ value, depth, path }: { value: unknown; depth: number; path: string }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (value === null) return <span className="text-gray-400">null</span>;
  if (value === undefined) return <span className="text-gray-400">undefined</span>;

  if (typeof value === 'boolean') {
    return <span className="text-orange-400">{String(value)}</span>;
  }

  if (typeof value === 'number') {
    return <span className="text-blue-400">{String(value)}</span>;
  }

  if (typeof value === 'string') {
    if (value.length > 200 && !collapsed) {
      return (
        <span className="text-green-400">
          "<span className="cursor-pointer hover:underline" onClick={() => setCollapsed(!collapsed)}>
            {value.substring(0, 200)}...
          </span>"
        </span>
      );
    }
    return <span className="text-green-400">"{value}"</span>;
  }

  if (Array.isArray(value)) {
    if (collapsed) {
      return (
        <span
          className="text-muted-foreground cursor-pointer hover:text-foreground select-none"
          onClick={() => setCollapsed(false)}
        >
          [{value.length}]
        </span>
      );
    }
    return (
      <span>
        <span
          className="text-muted-foreground cursor-pointer hover:text-foreground select-none"
          onClick={() => setCollapsed(true)}
        >
          [▼]
        </span>
        {' ['}
        <span style={{ paddingLeft: 12, display: 'block' }}>
          {value.map((item, i) => (
            <div key={i}>
              <span className="text-muted-foreground select-none">{i}: </span>
              <JsonNode value={item} depth={depth + 1} path={`${path}[${i}]`} />
              {i < value.length - 1 && <span className="text-muted-foreground">,</span>}
            </div>
          ))}
        </span>
        {']'}
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (collapsed) {
      return (
        <span
          className="text-muted-foreground cursor-pointer hover:text-foreground select-none"
          onClick={() => setCollapsed(false)}
        >
          {'{'}...{entries.length}{'}'}
        </span>
      );
    }
    return (
      <span>
        <span
          className="text-muted-foreground cursor-pointer hover:text-foreground select-none"
          onClick={() => setCollapsed(true)}
        >
          {'{'}▼{'}'}
        </span>
        <span style={{ paddingLeft: 12, display: 'block' }}>
          {entries.map(([key, val], i) => (
            <div key={key}>
              <span className="text-purple-400">"{key}"</span>
              <span className="text-muted-foreground">: </span>
              <JsonNode value={val} depth={depth + 1} path={`${path}.${key}`} />
              {i < entries.length - 1 && <span className="text-muted-foreground">,</span>}
            </div>
          ))}
        </span>
        {'}'}
      </span>
    );
  }

  return <span>{String(value)}</span>;
}

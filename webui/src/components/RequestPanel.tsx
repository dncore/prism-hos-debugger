import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { CapturedRequest } from '@/types';

interface Props {
  requests: CapturedRequest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type SortKey = 'time' | 'name' | 'waterfall';

const methodColors: Record<string,string> = {
  GET:'text-method-get', POST:'text-method-post', PUT:'text-method-put',
  PATCH:'text-method-patch', DELETE:'text-method-delete',
};

const statusBg: Record<string,string> = {
  '2':'bg-emerald-500/15 text-emerald-400',
  '3':'bg-amber-500/15 text-amber-400',
  '4':'bg-orange-500/15 text-orange-400',
  '5':'bg-red-500/15 text-red-400',
};

function typeIcon(ct: string): string {
  const t = ct.toLowerCase();
  if (t.includes('json') || t.includes('xml') || t.includes('form')) return '⬆';
  if (t.includes('javascript')) return 'JS';
  if (t.includes('css')) return '░';
  if (t.includes('image')) return '◻';
  if (t.includes('font') || t.includes('woff') || t.includes('ttf')) return 'F';
  if (t.includes('html')) return '◫';
  return '';
}

function fmtSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function RequestPanel({ requests, selectedId, onSelect }: Props) {
  const { t } = useI18n();
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    const list = [...requests];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'time') {
        cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      } else if (sortKey === 'name') {
        cmp = a.url.localeCompare(b.url);
      } else if (sortKey === 'waterfall') {
        cmp = (a.total_duration_ms || 0) - (b.total_duration_ms || 0);
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [requests, sortKey, sortAsc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortIcon = sortAsc ? ArrowDown : ArrowUp;

  if (!requests.length) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/30 text-xs text-muted-foreground flex-shrink-0">
          <span className="font-medium">{t('requests.name')}</span>
          <span className="ml-auto flex items-center gap-4">
            <span className="w-10 text-right">{t('requests.time')}</span>
            <span className="w-[60px] text-right">{t('requests.waterfall')}</span>
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2">
          <span className="text-sm">{t('empty.select_app')}</span>
        </div>
      </div>
    );
  }

  const max = Math.max(...requests.map(r => r.total_duration_ms || 0), 1);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/30 text-xs text-muted-foreground flex-shrink-0">
        <span className="font-medium">{t('requests.name')}</span>
        <span className="ml-auto flex items-center gap-3">
          <button
            onClick={() => toggleSort('name')}
            className={cn("flex items-center gap-0.5 hover:text-foreground transition-colors", sortKey === 'name' && 'text-foreground')}
          >
            {t('requests.name')}
            {sortKey === 'name' && <SortIcon className="w-2.5 h-2.5" />}
          </button>
          <button
            onClick={() => toggleSort('time')}
            className={cn("w-10 text-right flex items-center justify-end gap-0.5 hover:text-foreground transition-colors", sortKey === 'time' && 'text-foreground')}
          >
            {t('requests.time')}
            {sortKey === 'time' && <SortIcon className="w-2.5 h-2.5" />}
          </button>
          <button
            onClick={() => toggleSort('waterfall')}
            className={cn("w-[60px] text-right flex items-center justify-end gap-0.5 hover:text-foreground transition-colors", sortKey === 'waterfall' && 'text-foreground')}
          >
            {t('requests.waterfall')}
            {sortKey === 'waterfall' && <SortIcon className="w-2.5 h-2.5" />}
          </button>
        </span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {sorted.map(r => {
          const path = r.url.replace(/^https?:\/\/[^/]+/, '') || '/';
          const sc = r.response_status ? String(r.response_status)[0] : '';
          const icon = typeIcon(r.content_type);
          const size = r.response_body_size || 0;

          return (
            <div
              key={r.id}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 cursor-pointer border-b border-border text-xs hover:bg-accent transition-colors min-h-[28px]",
                selectedId === r.id && 'bg-accent',
                r.intercepted && 'border-l-2 border-l-purple-500'
              )}
              onClick={() => onSelect(r.id)}
            >
              <span className={cn("font-bold w-[34px] text-[11px] flex-shrink-0", methodColors[r.method] || '')}>
                {r.method}
              </span>
              <span className={cn(
                "min-w-[36px] h-[18px] rounded px-1 text-[10px] font-medium flex items-center justify-center flex-shrink-0",
                sc && statusBg[sc] ? statusBg[sc] : 'text-muted-foreground'
              )}>
                {r.response_status || '---'}
              </span>
              <span className="flex-1 truncate text-foreground/80" title={r.url}>{path}</span>
              {icon && (
                <span className="text-[9px] text-muted-foreground flex-shrink-0 w-3 text-center" title={r.content_type}>
                  {icon}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground flex-shrink-0 w-[34px] text-right">
                {fmtSize(size)}
              </span>
              <span className="w-[40px] text-right text-[11px] text-muted-foreground flex-shrink-0">
                {r.total_duration_ms ? `${r.total_duration_ms.toFixed(0)}ms` : ''}
              </span>
              <div className="w-[50px] h-1.5 bg-secondary rounded-sm flex-shrink-0 relative">
                <div
                  className="absolute h-full rounded-sm"
                  style={{
                    width: `${Math.min((r.total_duration_ms / max) * 100, 100).toFixed(1)}%`,
                    background: sc === '4' || sc === '5' ? 'hsl(var(--destructive))' : 'hsl(var(--primary) / 0.6)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

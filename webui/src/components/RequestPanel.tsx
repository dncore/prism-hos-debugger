import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { CapturedRequest } from '@/types';

interface Props {
  requests: CapturedRequest[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const methodColors: Record<string,string> = {
  GET:'text-method-get', POST:'text-method-post', PUT:'text-method-put',
  PATCH:'text-method-patch', DELETE:'text-method-delete',
};

export function RequestPanel({ requests, selectedId, onSelect }: Props) {
  const { t } = useI18n();

  if (!requests.length) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/30 text-xs text-muted-foreground flex-shrink-0">
          <span>{t('requests.name')}</span><span className="ml-auto">{t('requests.time')}</span><span className="text-right w-[70px]">{t('requests.waterfall')}</span>
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
        <span>{t('requests.name')}</span><span className="ml-auto">{t('requests.time')}</span><span className="text-right w-[70px]">{t('requests.waterfall')}</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {requests.map(r => {
          const path = r.url.replace(/^https?:\/\/[^/]+/, '') || '/';
          const sc = r.response_status ? `status-${String(r.response_status)[0]}` : '';
          return (
            <div
              key={r.id}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 cursor-pointer border-b border-border text-xs hover:bg-accent transition-colors min-h-[26px]",
                selectedId === r.id && 'bg-accent',
                r.intercepted && 'border-l-2 border-l-purple-500'
              )}
              onClick={() => onSelect(r.id)}
            >
              <span className={cn("font-bold w-10 text-[11px]", methodColors[r.method] || '')}>{r.method}</span>
              <span className={cn("w-8 text-[11px]", sc && `text-status-${sc}`)}>{r.response_status || '---'}</span>
              <span className="flex-1 truncate text-muted-foreground" title={r.url}>{path}</span>
              <span className="w-12 text-right text-[11px] text-muted-foreground">{r.total_duration_ms ? `${r.total_duration_ms.toFixed(0)}ms` : ''}</span>
              <div className="w-[60px] h-1.5 bg-secondary rounded-sm flex-shrink-0 relative">
                <div className="absolute h-full bg-primary/60 rounded-sm" style={{ width: `${Math.min((r.total_duration_ms / max) * 100, 100).toFixed(1)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

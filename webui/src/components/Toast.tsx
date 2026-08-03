import { cn } from '@/lib/utils';

interface ToastItem { id: number; msg: string; type: string; }
export function Toast({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2">
      {toasts.map(t => (
        <div key={t.id} className={cn("px-3 py-2 rounded-md text-sm text-white shadow-lg animate-[slideIn_0.2s_ease-out]", t.type === 'error' ? 'bg-red-600' : t.type === 'success' ? 'bg-green-600' : 'bg-primary')}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

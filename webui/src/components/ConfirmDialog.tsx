import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="border border-border rounded-lg w-[380px] shadow-xl p-5 space-y-4"
        style={{ background: 'hsl(var(--card))' }}
        onClick={e => e.stopPropagation()}
      >
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onCancel}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs border border-border hover:bg-accent transition-colors",
            )}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

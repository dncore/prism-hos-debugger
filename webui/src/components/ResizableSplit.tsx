import { useState, useCallback, useRef, useEffect } from 'react';

interface Props {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultRatio?: number;
  minLeftPx?: number;
  minRightPx?: number;
  storageKey: string;
}

export function ResizableSplit({
  left,
  right,
  defaultRatio = 0.45,
  minLeftPx = 280,
  minRightPx = 300,
  storageKey,
}: Props) {
  const [leftRatio, setLeftRatio] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? parseFloat(saved) : defaultRatio;
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Re-apply saved ratio if it changes externally (e.g. another tab)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        setLeftRatio(parseFloat(e.newValue));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMouseMove = (ev: MouseEvent) => {
        if (!containerRef.current || !dragging.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const total = rect.width;
        if (total <= 0) return;
        const x = ev.clientX - rect.left;
        const clamped = Math.max(minLeftPx, Math.min(x, total - minRightPx));
        setLeftRatio(clamped / total);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // Persist final ratio
        setLeftRatio((prev) => {
          localStorage.setItem(storageKey, String(prev));
          return prev;
        });
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [storageKey, minLeftPx, minRightPx],
  );

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
      <div style={{ width: `${leftRatio * 100}%`, minWidth: minLeftPx }}>{left}</div>
      <div
        className="w-[5px] flex-shrink-0 cursor-col-resize relative group"
        onMouseDown={onMouseDown}
      >
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-primary group-active:bg-primary transition-colors" />
      </div>
      <div className="flex-1 min-w-0">{right}</div>
    </div>
  );
}

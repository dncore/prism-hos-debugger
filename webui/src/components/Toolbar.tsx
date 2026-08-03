import { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Sun, Moon, Trash2, Circle, Play, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Device, AppProcess } from '@/types';

interface Props {
  device: Device | null; devices: Device[];
  onSelectDevice: (d: Device) => void;
  apps: AppProcess[]; loadingApps: boolean; onSelectApp: (a: AppProcess) => void;
  capturing: boolean; starting: boolean; requestCount: number; onClear: () => void;
  filter: string; onFilterChange: (v: string) => void;
  theme: string; onToggleTheme: () => void;
}

export function Toolbar({ device, devices, onSelectDevice, apps, loadingApps, onSelectApp, capturing, starting, requestCount, onClear, filter, onFilterChange, theme, onToggleTheme }: Props) {
  const [devOpen, setDevOpen] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [appQ, setAppQ] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const devBtnRef = useRef<HTMLButtonElement>(null);

  const filtered = appQ ? apps.filter(a => a.name.toLowerCase().includes(appQ.toLowerCase()) || String(a.pid).includes(appQ)) : apps;
  const deviceOffline = !device || device.status !== 'online';

  // Close dropdowns on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setDevOpen(false);
        setAppOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={toolbarRef} className="flex items-center gap-2.5 px-3 py-2 border-b border-border flex-shrink-0 min-h-[44px]" style={{background:'hsl(var(--card))'}}>
      {/* Device selector */}
      <div className="relative">
        <button
          ref={devBtnRef}
          disabled={starting || capturing}
          onClick={() => setDevOpen(!devOpen)}
          className="flex items-center gap-1.5 pl-2.5 pr-6 py-1.5 rounded-md text-xs border border-border bg-background hover:bg-accent transition-colors"
        >
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", device?.status === 'online' ? 'bg-green-500' : 'bg-gray-400')} />
          <span className="whitespace-nowrap">{device?.model ? `${device.model} (${device.device_id})` : (device?.device_id || 'No device')}</span>
          <ChevronDown className="w-3 h-3 absolute right-1.5 text-muted-foreground" />
        </button>
        {devOpen && (
          <div
            className="absolute top-full left-0 mt-1 z-[100] border border-border rounded-md shadow-lg max-h-60 overflow-y-auto whitespace-nowrap"
            style={{background:'hsl(var(--card))', minWidth: devBtnRef.current ? devBtnRef.current.offsetWidth : 220}}
            onClick={() => setDevOpen(false)}
          >
            {devices.map(d => (
              <div key={d.device_id} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-accent" onClick={() => onSelectDevice(d)}>
                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", d.status === 'online' ? 'bg-green-500' : 'bg-gray-400')} />
                <span className="flex-1">{d.model ? `${d.model} (${d.device_id})` : d.device_id}</span>
                <span className="text-muted-foreground text-[11px] flex-shrink-0">{d.transport} · {d.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* App picker */}
      <div className="relative flex-1 max-w-xs">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            placeholder={deviceOffline ? "Device offline" : "Select target app..."}
            value={appQ}
            disabled={deviceOffline}
            onChange={e => { setAppQ(e.target.value); setAppOpen(true); }}
            onFocus={() => setAppOpen(true)}
            onBlur={() => setTimeout(() => setAppOpen(false), 150)}
            className={cn(
              "w-full pl-7 pr-6 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary",
              deviceOffline && "opacity-50 cursor-not-allowed"
            )}
          />
          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
        {appOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 z-[100] border border-border rounded-md shadow-lg max-h-60 overflow-y-auto" style={{background:'hsl(var(--card))'}} onClick={() => setAppOpen(false)}>
            {loadingApps ? (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading apps...
              </div>
            ) : filtered.length ? filtered.map(a => (
              <div key={a.pid} className="flex justify-between items-center px-3 py-1.5 text-xs cursor-pointer hover:bg-accent" onClick={() => { setAppQ(a.short_name || a.name); onSelectApp(a); }}>
                <span className="truncate">{a.name}</span>
                <span className="text-muted-foreground ml-2 flex-shrink-0">PID {a.pid}</span>
              </div>
            )) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">No debuggable apps</div>
            )}
          </div>
        )}
      </div>

      {/* Status */}
      <div className={cn("flex items-center gap-1 text-xs whitespace-nowrap", starting ? 'text-yellow-500' : capturing ? 'text-green-500' : 'text-muted-foreground')}>
        {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : capturing ? <Play className="w-3 h-3 fill-current" /> : <Circle className="w-3 h-3" />}
        <span>{starting ? 'Initializing...' : capturing ? 'Listening' : 'Idle'}</span>
      </div>

      <div className="flex-1" />

      {/* Counter + clear */}
      <span className="text-xs text-muted-foreground">{requestCount} requests</span>
      <button onClick={onClear} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title="Clear">
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-5 bg-border" />

      {/* Filter */}
      <input
        placeholder="Filter URLs..."
        value={filter} onChange={e => onFilterChange(e.target.value)}
        className="w-44 px-2.5 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {/* Theme */}
      <button onClick={onToggleTheme} className="p-1.5 rounded hover:bg-accent transition-colors" title="Toggle theme">
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    </div>
  );
}

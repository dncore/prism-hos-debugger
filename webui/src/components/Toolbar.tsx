import { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Sun, Moon, Trash2, Circle, Play, Loader2, Eye, EyeOff, RefreshCw, SlidersHorizontal, Info, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { QUICK_FILTERS } from '@/lib/filter';
import type { Device, AppProcess } from '@/types';
import { RulesPopover } from './RulesPopover';

interface Props {
  device: Device | null; devices: Device[];
  onSelectDevice: (d: Device) => void;
  apps: AppProcess[]; loadingApps: boolean; onSelectApp: (a: AppProcess) => void;
  onLoadApps: () => void;
  filterSystemApps: boolean; onToggleFilterSystem: () => void;
  capturing: boolean; starting: boolean; requestCount: number; onClear: () => void;
  filter: string; onFilterChange: (v: string) => void;
  theme: string; onToggleTheme: () => void;
  activeRuleCount: number; onRulesChanged: () => void;
  preserveLog: boolean; onTogglePreserveLog: () => void;
  captureMode: 'grpc' | 'proxy'; onToggleCaptureMode: () => void;
  toast: (msg: string, type?: string) => void;
}

export function Toolbar({ device, devices, onSelectDevice, apps, loadingApps, onSelectApp, onLoadApps, filterSystemApps, onToggleFilterSystem, capturing, starting, requestCount, onClear, filter, onFilterChange, theme, onToggleTheme, activeRuleCount, onRulesChanged, preserveLog, onTogglePreserveLog, captureMode, onToggleCaptureMode, toast }: Props) {
  const { t, lang, setLang } = useI18n();
  const [devOpen, setDevOpen] = useState(false);
  const [appOpen, setAppOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [appQ, setAppQ] = useState('');
  const toolbarRef = useRef<HTMLDivElement>(null);
  const devBtnRef = useRef<HTMLButtonElement>(null);
  const rulesBtnRef = useRef<HTMLButtonElement>(null);

  const isSystemApp = (name: string) => name.includes('com.huawei') || name.includes('com.ohos');
  const baseApps = filterSystemApps ? apps.filter(a => !isSystemApp(a.name)) : apps;
  const filtered = appQ ? baseApps.filter(a => a.name.toLowerCase().includes(appQ.toLowerCase()) || String(a.pid).includes(appQ)) : baseApps;
  const deviceOffline = !device || device.status !== 'online';

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
    <div ref={toolbarRef} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-1.5 border-b border-border flex-shrink-0 min-h-[44px]" style={{background:'hsl(var(--card))'}}>
      {/* Usage hint */}
      <div className="relative group">
        <Info className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground cursor-help transition-colors" />
        <div className="absolute top-full left-0 mt-2 z-[200] w-80 p-3 rounded-md border border-border shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all pointer-events-none text-xs leading-relaxed" style={{background:'hsl(var(--card))'}}>
          <p className="font-semibold mb-1.5">{t('tooltip.title')}</p>
          <ol className="space-y-1 text-muted-foreground list-decimal pl-4">
            <li className="text-foreground font-medium">{t('tooltip.step1')}</li>
            <li>{t('tooltip.step2')}</li>
            <li>{t('tooltip.step3')}</li>
            <li>{t('tooltip.step4')}</li>
          </ol>
          <p className="mt-2 text-muted-foreground">{t('tooltip.footer')}</p>
        </div>
      </div>

      {/* Device selector */}
      <div className="relative flex-shrink-0">
        <button
          ref={devBtnRef}
          disabled={starting || capturing}
          onClick={() => setDevOpen(!devOpen)}
          className="flex items-center gap-1.5 pl-2.5 pr-6 py-1.5 rounded-md text-xs border border-border bg-background hover:bg-accent transition-colors"
        >
          <span className={cn("w-2 h-2 rounded-full flex-shrink-0", device?.status === 'online' ? 'bg-green-500' : 'bg-gray-400')} />
          <span className="whitespace-nowrap">{device?.model ? `${device.model} (${device.device_id})` : (device?.device_id || t('device.no_device'))}</span>
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
      <div className="relative w-56 flex-shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            placeholder={deviceOffline ? t('app.device_offline') : t('app.select')}
            value={appQ}
            disabled={deviceOffline}
            onChange={e => { setAppQ(e.target.value); setAppOpen(true); }}
            onFocus={() => { setAppOpen(true); if (!deviceOffline && !loadingApps) onLoadApps(); }}
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
                {t('app.loading')}
              </div>
            ) : filtered.length ? filtered.map(a => (
              <div key={a.pid} className="flex justify-between items-center px-3 py-1.5 text-xs cursor-pointer hover:bg-accent" onClick={() => { setAppQ(a.short_name || a.name); onSelectApp(a); }}>
                <span className="truncate">{a.name}</span>
                <span className="text-muted-foreground ml-2 flex-shrink-0">PID {a.pid}</span>
              </div>
            )) : (
              <div className="px-3 py-2 text-xs text-muted-foreground">{t('app.no_debuggable')}</div>
            )}
          </div>
        )}
      </div>

      {/* System app filter toggle */}
      <button
        onClick={onToggleFilterSystem}
        title={filterSystemApps ? t('filter.system_on') : t('filter.system_off')}
        className={cn(
          "flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors border",
          filterSystemApps
            ? 'bg-accent text-foreground border-border'
            : 'text-muted-foreground border-transparent hover:text-foreground hover:border-border'
        )}
      >
        {filterSystemApps ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
      </button>

      {/* Refresh app list */}
      <button
        onClick={() => { if (!deviceOffline) onLoadApps(); }}
        disabled={deviceOffline || loadingApps}
        title={t('refresh.app_list')}
        className={cn("p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground", (deviceOffline || loadingApps) && "opacity-30 cursor-not-allowed")}
      >
        <RefreshCw className={cn("w-3 h-3", loadingApps && "animate-spin")} />
      </button>

      {/* Status */}
      <div className={cn("flex items-center gap-1 text-xs whitespace-nowrap flex-shrink-0", starting ? 'text-yellow-500' : capturing ? 'text-green-500' : 'text-muted-foreground')}>
        {starting ? <Loader2 className="w-3 h-3 animate-spin" /> : capturing ? <Play className="w-3 h-3 fill-current" /> : <Circle className="w-3 h-3" />}
        <span>{starting ? t('capture.initializing') : capturing ? t('capture.listening') : t('capture.idle')}</span>
      </div>

      <div className="flex-1" />

      {/* Group: requests */}
      <div className="flex items-center gap-0.5">
        <span className="text-xs text-muted-foreground">{t('requests.count', { n: requestCount })}</span>
        <button onClick={onClear} className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title={t('capture.clear')}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onTogglePreserveLog}
          title={preserveLog ? 'Preserve log: ON' : 'Preserve log: OFF'}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
            preserveLog ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:text-foreground',
          )}
        >
          Preserve
        </button>
        <button
          onClick={onToggleCaptureMode}
          title={captureMode === 'grpc' ? 'Switch to proxy mode (with overrides)' : 'Switch to gRPC mode (no CA cert needed)'}
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
            captureMode === 'proxy' ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-border hover:text-foreground',
          )}
        >
          {captureMode === 'grpc' ? 'gRPC' : 'Proxy'}
        </button>
      </div>

      <div className="w-px h-5 bg-border flex-shrink-0" />

      {/* Group: filter */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {QUICK_FILTERS.map(qf => {
          const tokens = filter.split(/\s+/);
          const active = tokens.includes(qf.query);
          return (
            <button
              key={qf.label}
              onClick={() => {
                if (active) onFilterChange(tokens.filter(t => t !== qf.query).join(' '));
                else onFilterChange((filter + ' ' + qf.query).trim());
              }}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
                active ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/50',
              )}
            >
              {qf.label}
            </button>
          );
        })}
        <input
          placeholder={t('filter.filter_urls')}
          value={filter} onChange={e => onFilterChange(e.target.value)}
          className="w-48 px-2.5 py-1.5 rounded-md text-xs border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="w-px h-5 bg-border flex-shrink-0" />

      {/* Group: tools */}
      <div className="flex items-center gap-0.5">
        <div className="relative">
          <button
            ref={rulesBtnRef}
            onClick={() => setRulesOpen(!rulesOpen)}
            className={cn("relative p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground", rulesOpen && 'bg-accent text-foreground')}
            title={t('override.title')}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeRuleCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-primary text-[9px] text-primary-foreground flex items-center justify-center px-0.5">
                {activeRuleCount}
              </span>
            )}
          </button>
          <RulesPopover
            open={rulesOpen}
            onClose={() => setRulesOpen(false)}
            onRulesChanged={onRulesChanged}
            toast={toast}
          />
        </div>
        <button
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          className="p-1.5 rounded hover:bg-accent transition-colors text-xs font-medium text-muted-foreground hover:text-foreground w-7 text-center"
          title="Language"
        >
          {lang === 'en' ? '中' : 'EN'}
        </button>
        <button onClick={onToggleTheme} className="p-1.5 rounded hover:bg-accent transition-colors" title={t('theme.toggle')}>
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

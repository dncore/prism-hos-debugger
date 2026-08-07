import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Toolbar } from './components/Toolbar';
import { RequestPanel } from './components/RequestPanel';
import { DetailPanel } from './components/DetailPanel';
import { ResizableSplit } from './components/ResizableSplit';
import { Toast } from './components/Toast';
import { api } from './lib/api';
import { I18nProvider, useI18n } from './lib/i18n';
import { matchRequest, parseFilterQuery } from './lib/filter';
import type { Device, AppProcess, CapturedRequest } from './types';

function App() {
  const { t } = useI18n();
  const [theme, setTheme] = useState(() => localStorage.getItem('prism-theme') || 'dark');
  const [filterSystemApps, setFilterSystemApps] = useState(() => localStorage.getItem('prism-hide-system-apps') !== 'false');
  const [device, setDevice] = useState<Device | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [apps, setApps] = useState<AppProcess[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [captureMode, setCaptureMode] = useState<'grpc' | 'proxy'>(() =>
    (localStorage.getItem('prism-capture-mode') as 'grpc' | 'proxy') || 'grpc'
  );
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [requests, setRequests] = useState<CapturedRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preserveLog, setPreserveLog] = useState(() => localStorage.getItem('prism-preserve-log') === 'true');
  const [filter, setFilter] = useState(() => localStorage.getItem('prism-filter') || '');

  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleFilterChange = useCallback((v: string) => {
    setFilter(v);
    clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => localStorage.setItem('prism-filter', v), 300);
  }, []);
  const [activeRuleCount, setActiveRuleCount] = useState(0);
  const [toasts, setToasts] = useState<{id:number;msg:string;type:string}[]>([]);

  const toast = useCallback((msg: string, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('prism-theme', theme);
  }, [theme]);

  // Sync capture status on page load (handle stale sessions from previous page)
  useEffect(() => {
    api.captureStatus().then(s => {
      if (s.running) { setCapturing(true); }
    }).catch(() => {});
  }, []);

  const loadingAppsRef = useRef(false);

  // Auto-select device (prefer last-used from localStorage)
  useEffect(() => {
    const savedDeviceId = localStorage.getItem('prism-device');
    api.devices().then(async ds => {
      // Filter to physical devices only (exclude emulators with IP:port IDs)
      const physical = ds.filter((d: Device) => !/^\d+\.\d+\.\d+\.\d+:\d+$/.test(d.device_id));
      setDevices(physical);
      const saved = savedDeviceId ? physical.find((d: Device) => d.device_id === savedDeviceId && d.status === 'online') : null;
      const target = saved || physical.find((d: Device) => d.status === 'online');
      const online = target;
      if (online) {
        setDevice(online);
        await api.selectDevice(online.device_id);
        await loadApps();
      }
    }).catch(() => {});
  }, []);

  // Load apps — explicitly after backend select completes (avoids race)
  const loadApps = useCallback(async () => {
    if (loadingAppsRef.current) return;
    loadingAppsRef.current = true;
    setLoadingApps(true);
    try { setApps(await api.captureApps()); }
    catch { setApps([]); }
    finally {
      setLoadingApps(false);
      loadingAppsRef.current = false;
    }
  }, []);

  // SSE for real-time request updates
  useEffect(() => {
    const es = new EventSource('/api/requests/stream');
    es.addEventListener('request', (e: MessageEvent) => {
      try {
        const req = JSON.parse(e.data) as CapturedRequest;
        setRequests(prev => [req, ...prev].slice(0, 1000));
      } catch {}
    });
    return () => es.close();
  }, []);

  const selectDevice = async (d: Device) => {
    setDevice(d);
    localStorage.setItem('prism-device', d.device_id);
    setApps([]);  // clear immediately so stale list isn't shown
    try {
      const resp = await api.selectDevice(d.device_id);
      if (!resp.online) toast(t('device.offline', { id: d.device_id }), 'error');
      else toast(t('device.connected', { id: d.device_id }), 'success');
      await loadApps();
    } catch (e: any) {
      toast(t('device.select_failed', { msg: e.message }), 'error');
      setDevice(null);
    }
  };

  const startCaptureRef = useRef<(pid: number) => Promise<void>>(null!);
  const lastPidRef = useRef<number | null>(null);
  const connectingRef = useRef(false);

  const startCapture = useCallback(async (pid: number) => {
    setStarting(true);
    try {
      const status = await api.captureStatus();
      if (status.running) await api.captureStop();
      await api.captureStart(pid, captureMode);
      setCapturing(true);
      lastPidRef.current = pid;
      if (!preserveLog) { setRequests([]); setSelectedId(null); await api.clearRequests(); }
      toast(t('capture.capturing', { pid }), 'success');
    } catch (e: any) {
      setCapturing(false);
      toast(t('capture.failed', { msg: e.message }), 'error');
    } finally {
      setStarting(false);
      connectingRef.current = false;
    }
  }, [toast, t]);

  startCaptureRef.current = startCapture;

  const selectApp = async (app: AppProcess) => {
    localStorage.setItem('prism-last-app', JSON.stringify({pid: app.pid, name: app.name, short_name: app.short_name}));
    await startCapture(app.pid);
  };

  // Poll for PID changes when capturing (handles app redeploy/restart).
  // Only restarts if the current PID has disappeared — not if the app
  // has multiple processes with the same name (main + service worker).
  useEffect(() => {
    if (!capturing) return;
    const interval = setInterval(async () => {
      if (connectingRef.current) return;
      try {
        const lastApp = localStorage.getItem('prism-last-app');
        if (!lastApp) return;
        const { name } = JSON.parse(lastApp);
        const apps = await api.captureApps();
        const currentPid = lastPidRef.current;
        if (currentPid && !apps.some((a: AppProcess) => a.name === name && a.pid === currentPid)) {
          // Current PID disappeared — find any process with this name
          const current = apps.find((a: AppProcess) => a.name === name);
          if (current) {
            connectingRef.current = true;
            localStorage.setItem('prism-last-app', JSON.stringify({pid: current.pid, name: current.name, short_name: current.short_name}));
            await startCaptureRef.current(current.pid);
          }
        }
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [capturing, toast]);

  const clearRequests = async () => {
    setRequests([]);
    await api.clearRequests();
  };

  const toggleFilterSystem = useCallback(() => {
    setFilterSystemApps(prev => {
      const next = !prev;
      localStorage.setItem('prism-hide-system-apps', String(next));
      return next;
    });
  }, []);

  // Sync active rule count for Toolbar badge
  const refreshRuleCount = useCallback(() => {
    api.rules().then(rules => setActiveRuleCount(rules.filter((r: any) => r.enabled).length)).catch(() => {});
  }, []);

  const togglePreserveLog = useCallback(() => {
    setPreserveLog(prev => {
      const next = !prev;
      localStorage.setItem('prism-preserve-log', String(next));
      return next;
    });
  }, []);

  const toggleCaptureMode = useCallback(() => {
    setCaptureMode(prev => {
      const next = prev === 'grpc' ? 'proxy' : 'grpc';
      localStorage.setItem('prism-capture-mode', next);
      return next;
    });
  }, []);

  useEffect(() => { refreshRuleCount(); }, [refreshRuleCount]);

  const filterTokens = useMemo(() => parseFilterQuery(filter), [filter]);
  const filtered = useMemo(
    () => filterTokens.length ? requests.filter(r => matchRequest(r, filterTokens)) : requests,
    [requests, filterTokens],
  );
  const selected = useMemo(() => requests.find(r => r.id === selectedId) || null, [requests, selectedId]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <Toolbar
        device={device} devices={devices} onSelectDevice={selectDevice}
        apps={apps} loadingApps={loadingApps} onSelectApp={selectApp}
        onLoadApps={loadApps}
        filterSystemApps={filterSystemApps}
        onToggleFilterSystem={toggleFilterSystem}
        capturing={capturing} starting={starting}
        requestCount={requests.length} onClear={clearRequests}
        filter={filter} onFilterChange={handleFilterChange}
        theme={theme} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
        activeRuleCount={activeRuleCount}
        onRulesChanged={refreshRuleCount}
        preserveLog={preserveLog}
        onTogglePreserveLog={togglePreserveLog}
        captureMode={captureMode}
        onToggleCaptureMode={toggleCaptureMode}
        toast={toast}
      />
      <ResizableSplit storageKey="prism-split-ratio"
        left={<RequestPanel requests={filtered} selectedId={selectedId} onSelect={setSelectedId} />}
        right={<DetailPanel request={selected} toast={toast} onRulesChanged={refreshRuleCount} />}
      />
      <Toast toasts={toasts} />
    </div>
  );
}

export default function AppWrapper() {
  return (
    <I18nProvider>
      <App />
    </I18nProvider>
  );
}

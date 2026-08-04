import { useState, useEffect, useCallback, useRef } from 'react';
import { Toolbar } from './components/Toolbar';
import { RequestPanel } from './components/RequestPanel';
import { DetailPanel } from './components/DetailPanel';
import { OverridePanel } from './components/OverridePanel';
import { ResizableSplit } from './components/ResizableSplit';
import { Toast } from './components/Toast';
import { api } from './lib/api';
import type { Device, AppProcess, CapturedRequest, OverrideRule } from './types';

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('prism-theme') || 'dark');
  const [filterSystemApps, setFilterSystemApps] = useState(() => localStorage.getItem('prism-hide-system-apps') !== 'false');
  const [device, setDevice] = useState<Device | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [apps, setApps] = useState<AppProcess[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [requests, setRequests] = useState<CapturedRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
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

  // SSE
  useEffect(() => {
    const es = new EventSource('/api/requests/stream');
    es.addEventListener('request', (e: MessageEvent) => {
      const req = JSON.parse(e.data) as CapturedRequest;
      setRequests(prev => [req, ...prev].slice(0, 1000));
    });
    return () => es.close();
  }, []);

  const selectDevice = async (d: Device) => {
    setDevice(d);
    localStorage.setItem('prism-device', d.device_id);
    setApps([]);  // clear immediately so stale list isn't shown
    try {
      const resp = await api.selectDevice(d.device_id);
      if (!resp.online) toast(`Device ${d.device_id} is offline — apps may be empty`, 'error');
      else toast(`Connected: ${d.device_id}`, 'success');
      await loadApps();  // reload only after backend switch completes
    } catch (e: any) {
      toast('Failed to select device: ' + e.message, 'error');
      setDevice(null);
    }
  };

  const startCapture = async (pid: number) => {
    setStarting(true);
    try {
      // Query actual backend state — avoids 409 and stale frontend state
      const status = await api.captureStatus();
      if (status.running) await api.captureStop();
      await api.captureStart(pid, 'grpc');
      setCapturing(true);
      toast(`Capturing PID ${pid}`, 'success');
    } catch (e: any) {
      setCapturing(false);
      toast('Capture failed: ' + e.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  const selectApp = async (app: AppProcess) => {
    localStorage.setItem('prism-last-app', JSON.stringify({pid: app.pid, name: app.name}));
    await startCapture(app.pid);
  };

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

  const selected = requests.find(r => r.id === selectedId) || null;
  const filtered = filter ? requests.filter(r => r.url.toLowerCase().includes(filter.toLowerCase())) : requests;

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
        filter={filter} onFilterChange={setFilter}
        theme={theme} onToggleTheme={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      />
      <ResizableSplit storageKey="prism-split-ratio"
        left={<RequestPanel requests={filtered} selectedId={selectedId} onSelect={setSelectedId} />}
        right={<DetailPanel request={selected} />}
      />
      <OverridePanel toast={toast} />
      <Toast toasts={toasts} />
    </div>
  );
}

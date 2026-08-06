const BASE = typeof window !== 'undefined' && window.location.protocol !== 'http:' ? 'http://localhost:8900' : '';

async function request(method: string, path: string, body?: unknown, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' }, signal: controller.signal };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || res.statusText);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get:    (p: string)            => request('GET', p),
  post:   (p: string, b?: unknown) => request('POST', p, b),
  put:    (p: string, b: unknown)  => request('PUT', p, b),
  patch:  (p: string)              => request('PATCH', p),
  delete: (p: string)              => request('DELETE', p),

  devices:       ()                  => api.get('/api/devices'),
  selectDevice:  (id: string)        => api.post('/api/devices/select', { device_id: id }),
  captureStatus: ()                  => api.get('/api/capture/status'),
  captureApps:   ()                  => api.get('/api/capture/apps'),
  captureStart:  (pid: number, mode = 'grpc') => request('POST', '/api/capture/start', { mode, pid }, 15000),
  captureStop:   ()                  => request('POST', '/api/capture/stop', undefined, 15000),
  requests:      (params?: Record<string,string>) => api.get('/api/requests?' + new URLSearchParams(params)),
  getRequest:    (id: string)        => api.get(`/api/requests/${id}`),
  clearRequests: ()                  => api.delete('/api/requests'),
  rules:         ()                  => api.get('/api/rules'),
  createRule:    (r: unknown)        => api.post('/api/rules', r),
  updateRule:    (id: string, r: unknown) => api.put(`/api/rules/${id}`, r),
  deleteRule:    (id: string)        => api.delete(`/api/rules/${id}`),
  toggleRule:    (id: string)        => api.patch(`/api/rules/${id}/toggle`),
};

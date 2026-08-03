const BASE = '';

async function request(method: string, path: string, body?: unknown) {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
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
  captureStart:  (pid: number, mode = 'grpc') => api.post('/api/capture/start', { mode, pid }),
  captureStop:   ()                  => api.post('/api/capture/stop'),
  requests:      (params?: Record<string,string>) => api.get('/api/requests?' + new URLSearchParams(params)),
  getRequest:    (id: string)        => api.get(`/api/requests/${id}`),
  clearRequests: ()                  => api.delete('/api/requests'),
  rules:         ()                  => api.get('/api/rules'),
  createRule:    (r: unknown)        => api.post('/api/rules', r),
  updateRule:    (id: string, r: unknown) => api.put(`/api/rules/${id}`, r),
  deleteRule:    (id: string)        => api.delete(`/api/rules/${id}`),
  toggleRule:    (id: string)        => api.patch(`/api/rules/${id}/toggle`),
};

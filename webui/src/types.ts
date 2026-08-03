export interface Device {
  device_id: string; name: string; status: 'online' | 'offline';
  transport: string; model: string; version: string;
}

export interface AppProcess { pid: number; name: string; short_name: string; }

export interface CapturedRequest {
  id: string; url: string; method: string; scheme: string;
  request_headers: Record<string,string>; request_body: string | null; request_body_size: number;
  response_status: number | null; response_headers: Record<string,string>;
  response_body: string | null; response_body_size: number;
  timestamp: string; dns_duration_ms: number; connect_duration_ms: number;
  tls_duration_ms: number; ttfb_ms: number; total_duration_ms: number;
  is_https: boolean; intercepted: boolean; rule_id: string | null;
  error: string | null; remote_address: string; content_type: string;
}

export interface OverrideRule {
  id: string; name: string; enabled: boolean;
  match_type: string; match_pattern: string; match_method: string | null;
  override_type: string; redirect_url: string | null;
  request_headers_to_add: Record<string,string>; request_headers_to_remove: string[];
  response_status_override: number | null; response_body_override: string | null;
  response_headers_to_add: Record<string,string>; response_headers_to_remove: string[];
  latency_ms: number; created_at: string; updated_at: string;
}

export interface CaptureStatus {
  running: boolean; backend_type: string | null;
  supports_overrides: boolean; proxy_port: number | null;
}

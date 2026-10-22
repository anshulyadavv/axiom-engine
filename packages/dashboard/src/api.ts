export interface CacheStatsSnapshot {
  is_connected: boolean;
  hits: number;
  misses: number;
  hit_ratio_pct: number | null;
  writes: number;
  errors: number;
  avg_read_latency_ms: number | null;
  avg_write_latency_ms: number | null;
  used_memory_human: string | null;
  connected_clients: number | null;
  evicted_keys: number | null;
  total_operations: number;
  status_message: string;
}

export interface AiTelemetrySnapshot {
  total_invocations: number;
  successful_invocations: number;
  failed_invocations: number;
  total_tool_calls: number;
  total_tokens: number;
  avg_latency_ms: number | null;
  active_provider: string;
  is_test_adapter: boolean;
}

export interface OperationalEvent {
  event_id: string;
  category: 'workflow' | 'run' | 'step' | 'worker' | 'cache' | 'ai_agent' | 'outbox' | 'system';
  event_type: string;
  timestamp: string;
  tenant_id?: string;
  workflow_id?: string;
  run_id?: string;
  step_id?: string;
  worker_id?: string;
  correlation_id?: string;
  summary: string;
  metadata?: Record<string, any>;
}

export interface WorkloadStatusResponse {
  is_running: boolean;
  rate_per_sec: number;
  max_concurrency: number;
  total_runs_spawned: number;
  uptime_seconds: number;
  supported_workloads: string[];
}

export interface UserInfo {
  id: string;
  tenant_id: string;
  email: string;
  role: 'admin' | 'operator' | 'viewer';
  created_at: string;
}

export function getApiConfig() {
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL;
  const defaultUrl = envUrl ? (envUrl.endsWith('/v1') ? envUrl : `${envUrl.replace(/\/+$/, '')}/v1`) : 'http://localhost:3000/v1';
  const envKey = (import.meta as any).env?.VITE_API_KEY;

  return {
    url: localStorage.getItem('axiom_api_url') || defaultUrl,
    key: localStorage.getItem('axiom_api_key') || envKey || 'axm_live_dummykey'
  };
}

function getHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const sessionToken = localStorage.getItem('axiom_session_token');
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  } else {
    headers['Authorization'] = `Bearer ${getApiConfig().key}`;
  }
  const csrfToken = localStorage.getItem('axiom_csrf_token');
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  return headers;
}

export const api = {
  getOverview: async () => {
    const baseUrl = getApiConfig().url.replace(/\/v1\/?$/, '');
    let apiReachable = true;
    let postgresStatus: 'Healthy' | 'Unreachable' | 'Not checked' = 'Not checked';
    let natsStatus: 'Healthy' | 'Unreachable' | 'Not checked' = 'Not checked';
    let activeWorkers = 0;

    try {
      const res = await fetch(`${baseUrl}/ready`);
      if (res.ok) {
        const data = await res.json();
        postgresStatus = data.checks?.postgres === 'ok' ? 'Healthy' : 'Unreachable';
        natsStatus = data.checks?.nats === 'ok' ? 'Healthy' : 'Unreachable';
      } else {
        postgresStatus = 'Unreachable';
        natsStatus = 'Unreachable';
        apiReachable = false;
      }
    } catch {
      postgresStatus = 'Unreachable';
      natsStatus = 'Unreachable';
      apiReachable = false;
    }
    
    let activeRuns = 0;
    let last24h = { started: 0, completed: 0, failed: 0 };
    let avgDurationMs: number | null = null;
    let successRatePct: number | null = null;
    let statsAvailable = apiReachable;

    if (apiReachable) {
      try {
        const statsRes = await fetch(`${getApiConfig().url}/overview/stats`, { headers: getHeaders() });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          activeRuns = statsData.data.active_runs;
          last24h.completed = statsData.data.last_24h_completed;
          last24h.failed = statsData.data.last_24h_failed;
          activeWorkers = statsData.data.active_workers;
          avgDurationMs = statsData.data.avg_duration_ms ?? null;
          successRatePct = statsData.data.success_rate_pct ?? null;
        } else {
          statsAvailable = false;
        }
      } catch (e) {
        console.warn("Failed to fetch overview stats", e);
        statsAvailable = false;
      }
    }
    
    return {
      activeRuns,
      last24h,
      systemHealth: {
        postgres: postgresStatus,
        nats: natsStatus,
        workers: activeWorkers,
        apiReachable,
        apiUrl: baseUrl,
      },
      statsAvailable,
      avgDurationMs,
      successRatePct,
    };
  },

  getCacheTelemetry: async (): Promise<CacheStatsSnapshot> => {
    const res = await fetch(`${getApiConfig().url}/telemetry/cache`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch cache telemetry');
    const { data } = await res.json();
    return data;
  },

  getAiTelemetry: async (): Promise<AiTelemetrySnapshot> => {
    const res = await fetch(`${getApiConfig().url}/telemetry/ai`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch AI telemetry');
    const { data } = await res.json();
    return data;
  },

  getRecentEvents: async (limit = 50): Promise<OperationalEvent[]> => {
    const res = await fetch(`${getApiConfig().url}/events/recent?limit=${limit}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch recent events');
    const { data } = await res.json();
    return data;
  },

  getWorkloadStatus: async (): Promise<WorkloadStatusResponse> => {
    const res = await fetch(`${getApiConfig().url}/workload/status`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch workload status');
    const { data } = await res.json();
    return data;
  },

  startWorkloadGenerator: async (rate_per_sec = 1, max_concurrency = 5) => {
    const res = await fetch(`${getApiConfig().url}/workload/start`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ rate_per_sec, max_concurrency })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to start workload generator');
    }
    return res.json();
  },

  stopWorkloadGenerator: async () => {
    const res = await fetch(`${getApiConfig().url}/workload/stop`, {
      method: 'POST',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Failed to stop workload generator');
    return res.json();
  },

  triggerWorkload: async (workload_type: string) => {
    const res = await fetch(`${getApiConfig().url}/workload/trigger`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ workload_type })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to trigger workload');
    }
    return res.json();
  },

  cleanupWorkload: async () => {
    const res = await fetch(`${getApiConfig().url}/workload/cleanup`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ confirm: true })
    });
    if (!res.ok) throw new Error('Failed to cleanup dev workloads');
    return res.json();
  },

  getMe: async (): Promise<UserInfo | null> => {
    try {
      const res = await fetch(`${getApiConfig().url}/auth/me`, { 
        headers: getHeaders(),
        credentials: 'include'
      });
      if (!res.ok) return null;
      const { data } = await res.json();
      return data;
    } catch {
      return null;
    }
  },

  login: async (email: string, password: string) => {
    const res = await fetch(`${getApiConfig().url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Invalid credentials');
    }
    const data = await res.json();
    if (data.data?.csrf_token) {
      localStorage.setItem('axiom_csrf_token', data.data.csrf_token);
    }
    if (data.data?.session_token) {
      localStorage.setItem('axiom_session_token', data.data.session_token);
    }
    return data.data;
  },

  logout: async () => {
    try {
      await fetch(`${getApiConfig().url}/auth/logout`, {
        method: 'POST',
        headers: getHeaders(),
        credentials: 'include'
      });
    } finally {
      localStorage.removeItem('axiom_csrf_token');
      localStorage.removeItem('axiom_session_token');
    }
  },

  bootstrapAdmin: async (email: string, password: string, bootstrap_secret?: string) => {
    const res = await fetch(`${getApiConfig().url}/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, bootstrap_secret })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Bootstrap failed');
    }
    const data = await res.json();
    if (data.data?.csrf_token) {
      localStorage.setItem('axiom_csrf_token', data.data.csrf_token);
    }
    if (data.data?.session_token) {
      localStorage.setItem('axiom_session_token', data.data.session_token);
    }
    return data.data;
  },
  
  getWorkflows: async () => {
    const res = await fetch(`${getApiConfig().url}/workflows`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch workflows');
    const { data } = await res.json();
    return data;
  },
  
  getWorkflow: async (id: string) => {
    const res = await fetch(`${getApiConfig().url}/workflows/${id}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch workflow');
    const { data } = await res.json();
    return {
      ...data,
      recentRuns: []
    };
  },
  
  getRun: async (id: string) => {
    const res = await fetch(`${getApiConfig().url}/runs/${id}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch run');
    const { data } = await res.json();
    
    let events = [];
    try {
      const histRes = await fetch(`${getApiConfig().url}/runs/${id}/history`, { headers: getHeaders() });
      if (histRes.ok) {
        const histData = await histRes.json();
        events = histData.data || [];
      }
    } catch (e) {
      console.warn("Failed to fetch history:", e);
    }
    
    return {
      ...data,
      workflowName: data.workflow_name,
      steps: data.steps || [],
      events
    };
  },
  
  getRunTimeline: async (id: string) => {
    const res = await fetch(`${getApiConfig().url}/runs/${id}/timeline`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch run timeline');
    const { data } = await res.json();
    return {
      ...data.run,
      workflowName: data.workflow_name,
      events: data.events || [],
      steps: data.steps || [],
      children: data.children || [],
    };
  },

  getApiKeys: async () => {
    const res = await fetch(`${getApiConfig().url}/api-keys`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch API keys');
    const { data } = await res.json();
    return data;
  },

  createApiKey: async (name: string) => {
    const res = await fetch(`${getApiConfig().url}/api-keys`, { 
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to create API key');
    const { data } = await res.json();
    return data;
  },

  revokeApiKey: async (id: string) => {
    const res = await fetch(`${getApiConfig().url}/api-keys/${id}/revoke`, { 
      method: 'POST',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Failed to revoke API key');
    const { data } = await res.json();
    return data;
  },

  search: async (q: string) => {
    const res = await fetch(`${getApiConfig().url}/search?q=${encodeURIComponent(q)}`, {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Failed to search');
    const { data } = await res.json();
    return data;
  },

  getRuns: async (status?: string, limit = 50) => {
    const query = new URLSearchParams();
    if (status && status !== 'all') query.set('status', status);
    if (limit) query.set('limit', limit.toString());
    const res = await fetch(`${getApiConfig().url}/runs?${query.toString()}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch runs');
    const json = await res.json();
    const items = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : (json.data?.data || []));
    return {
      data: items,
      pagination: json.pagination || { cursor: null, has_more: false }
    };
  },

  getWorkers: async () => {
    const res = await fetch(`${getApiConfig().url}/workers`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch workers');
    const json = await res.json();
    const items = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : []);
    return items;
  },

  startRun: async (workflowId: string, input: any) => {
    const res = await fetch(`${getApiConfig().url}/workflows/${workflowId}/runs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ input })
    });
    if (!res.ok) throw new Error('Failed to start run');
    const { data } = await res.json();
    return data;
  },

  registerWorkflow: async (payload: { name: string, version: number, description?: string }) => {
    const res = await fetch(`${getApiConfig().url}/workflows`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to register workflow');
    const { data } = await res.json();
    return data;
  }
};

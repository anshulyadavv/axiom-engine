export function getApiConfig() {
  return {
    url: localStorage.getItem('axiom_api_url') || 'http://localhost:3000/v1',
    key: localStorage.getItem('axiom_api_key') || 'axm_live_dummykey'
  };
}

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getApiConfig().key}`
  };
}

export const api = {
  getOverview: async () => {
    // Determine base URL dynamically (strip /v1 if present) for /ready
    const baseUrl = getApiConfig().url.replace(/\/v1\/?$/, '');
    const res = await fetch(`${baseUrl}/ready`);
    let health = { postgres: 'unknown', nats: 'unknown', workers: 0 };
    if (res.ok) {
      const data = await res.json();
      health.postgres = data.checks?.postgres || 'ok';
      health.nats = data.checks?.nats || 'ok';
    }
    
    // Fetch real stats
    let activeRuns = 0;
    let last24h = { started: 0, completed: 0, failed: 0 };
    try {
      const statsRes = await fetch(`${getApiConfig().url}/overview/stats`, { headers: getHeaders() });
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        activeRuns = statsData.data.active_runs;
        last24h.completed = statsData.data.last_24h_completed;
        last24h.failed = statsData.data.last_24h_failed;
        health.workers = statsData.data.active_workers;
      }
    } catch (e) {
      console.warn("Failed to fetch overview stats", e);
    }
    
    return {
      activeRuns,
      last24h,
      systemHealth: health
    };
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
    
    // Fetch history
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

  getRuns: async () => {
    const res = await fetch(`${getApiConfig().url}/runs`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch runs');
    const { data } = await res.json();
    return data;
  },

  getWorkers: async () => {
    const res = await fetch(`${getApiConfig().url}/workers`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch workers');
    const { data } = await res.json();
    return data;
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

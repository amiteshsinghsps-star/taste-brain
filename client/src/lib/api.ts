const API_BASE = '/api';

let accessToken: string | null = null;
let onUnauthenticatedCallback: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    try { localStorage.setItem('accessToken', token); } catch {}
  } else {
    try { localStorage.removeItem('accessToken'); } catch {}
  }
}

export function getAccessToken(): string | null {
  if (!accessToken) {
    try { accessToken = localStorage.getItem('accessToken'); } catch {}
  }
  return accessToken;
}

export function setOnUnauthenticated(cb: () => void) {
  onUnauthenticatedCallback = cb;
}

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  const activeToken = getAccessToken();
  if (activeToken) {
    headers['Authorization'] = `Bearer ${activeToken}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Handle 401 Unauthorized -> Attempt token refresh via HTTP-only refreshToken cookie
  if (res.status === 401 && !isRetry && endpoint !== '/auth/login' && endpoint !== '/auth/register' && endpoint !== '/auth/refresh') {
    try {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        if (refreshData.accessToken) {
          setAccessToken(refreshData.accessToken);
          return fetchApi<T>(endpoint, options, true); // Retry original API call with new token
        }
      }
    } catch (e) {
      console.warn('Token refresh failed:', e);
    }

    // If refresh fails or token invalid -> clear credentials and trigger logout
    setAccessToken(null);
    if (onUnauthenticatedCallback) {
      onUnauthenticatedCallback();
    }
    throw new Error('Session expired. Please log in again.');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'API request failed');
  }

  return data as T;
}

export const api = {
  // Auth & Session Steer
  setOnUnauthenticated: (cb: () => void) => setOnUnauthenticated(cb),
  register: async (body: any) => {
    const res = await fetchApi<{ user: any; accessToken: string }>('/auth/register', { method: 'POST', body: JSON.stringify(body) });
    if (res.accessToken) setAccessToken(res.accessToken);
    return res;
  },
  login: async (body: any) => {
    const res = await fetchApi<{ user: any; accessToken: string }>('/auth/login', { method: 'POST', body: JSON.stringify(body) });
    if (res.accessToken) setAccessToken(res.accessToken);
    return res;
  },
  me: async () => {
    const res = await fetchApi<{ user: any }>('/auth/me');
    return res;
  },
  logout: async () => {
    try {
      await fetchApi('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
    }
  },

  // Ingestion & Connectors
  connectorStatus: () => fetchApi('/status/connectors'),
  graphStatus: () => fetchApi('/status/graph'),
  listSources: () => fetchApi('/ingestion/sources'),
  createSource: (body: any) => fetchApi('/ingestion/sources', { method: 'POST', body: JSON.stringify(body) }),
  syncSource: (id: string) => fetchApi(`/ingestion/sources/${id}/sync`, { method: 'POST' }),
  deleteSource: (id: string) => fetchApi(`/ingestion/sources/${id}`, { method: 'DELETE' }),
  listDocuments: (query?: string) => fetchApi(`/ingestion/documents${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  uploadDocument: (body: { title: string; content: string }) => fetchApi('/ingestion/upload', { method: 'POST', body: JSON.stringify(body) }),

  // Brain & Knowledge Graph (per-tenant FalkorDB)
  queryBrain: (query: string) => fetchApi('/brain/query', { method: 'POST', body: JSON.stringify({ query }) }),
  getGraph: () => fetchApi('/brain/graph'),
  extractGraph: () => fetchApi('/brain/graph/extract', { method: 'POST' }),
  seedDemo: () => fetchApi('/brain/seed-demo', { method: 'POST' }),
  getTrace: (traceId: string) => fetchApi(`/brain/trace/${traceId}`),
  getStale: () => fetchApi('/brain/stale'),
  revalidateStale: (id: string) => fetchApi(`/brain/stale/${id}/revalidate`, { method: 'POST' }),
  impactOfChange: (policyId: string) => fetchApi('/brain/impact', { method: 'POST', body: JSON.stringify({ policyId }) }),
  whoKnows: (topic: string) => fetchApi(`/brain/who-knows?topic=${encodeURIComponent(topic)}`),

  // Policy Time Machine, Why-Not, Ledger, Health, Compare (v3)
  listGraphRules: () => fetchApi('/brain/rules'),
  simulateRule: (body: { ruleId: string; candidateParams: Record<string, any> }) =>
    fetchApi('/brain/simulate', { method: 'POST', body: JSON.stringify(body) }),
  applySimulation: (id: string, body?: { approver?: string; approverNote?: string }) =>
    fetchApi(`/brain/simulate/${id}/apply`, { method: 'POST', body: JSON.stringify(body || {}) }),
  discardSimulation: (id: string) => fetchApi(`/brain/simulate/${id}/discard`, { method: 'POST' }),
  whyNot: (booking: string) => fetchApi(`/brain/why-not?booking=${encodeURIComponent(booking)}`),
  listLedger: (limit?: number) => fetchApi(`/ledger${limit ? `?limit=${limit}` : ''}`),
  healthReport: () => fetchApi('/brain/health'),
  compareAnswer: (question: string) => fetchApi('/brain/compare', { method: 'POST', body: JSON.stringify({ question }) }),

  // Agent memory (Track 02)
  memoryStats: () => fetchApi('/memory/stats'),
  recallMemory: (q: string, agentId?: string) => fetchApi(`/memory/recall?q=${encodeURIComponent(q)}${agentId ? `&agentId=${agentId}` : ''}`),
  writeEpisode: (body: { summary: string; outcome?: string; agentId?: string; shared?: boolean }) =>
    fetchApi('/memory/episodes', { method: 'POST', body: JSON.stringify(body) }),

  // Skills
  listSkills: () => fetchApi('/skills'),
  extractSkills: () => fetchApi('/skills/extract', { method: 'POST' }),
  createSkill: (body: any) => fetchApi('/skills/create', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill: (body: any) => fetchApi('/skills/update', { method: 'POST', body: JSON.stringify(body) }),
  deleteSkill: (id: string) => fetchApi(`/skills/${id}`, { method: 'DELETE' }),
  executeSkill: (body: any) => fetchApi('/skills/execute', { method: 'POST', body: JSON.stringify(body) }),

  // Agents & Autopilot
  listAgents: () => fetchApi('/agents'),
  createAgent: (body: any) => fetchApi('/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgentStatus: (id: string, status: string) => fetchApi(`/agents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  updateAgentMode: (id: string, mode: string) => fetchApi(`/agents/${id}/mode`, { method: 'PATCH', body: JSON.stringify({ mode }) }),
  deleteAgent: (id: string) => fetchApi(`/agents/${id}`, { method: 'DELETE' }),
  runFreight: (id: string, body: any) => fetchApi(`/agents/${id}/freight`, { method: 'POST', body: JSON.stringify(body) }),
  runWorkflow: (id: string, body: any) => fetchApi(`/agents/${id}/workflow`, { method: 'POST', body: JSON.stringify(body) }),
  listTasks: (status?: string) => fetchApi(`/agents/tasks${status ? `?status=${status}` : ''}`),
  approveTask: (taskId: string) => fetchApi(`/agents/tasks/${taskId}/approve`, { method: 'POST' }),
  getAuditLogs: () => fetchApi('/agents/audit'),

  // Control Plane & Team
  listTeam: () => fetchApi('/control/team'),
  createTeamMember: (body: any) => fetchApi('/control/team', { method: 'POST', body: JSON.stringify(body) }),
  grantScope: (body: any) => fetchApi('/control/access/grant', { method: 'POST', body: JSON.stringify(body) }),
  revokeScope: (body: any) => fetchApi('/control/access/revoke', { method: 'POST', body: JSON.stringify(body) }),
  deleteTeamMember: (id: string) => fetchApi(`/control/team/${id}`, { method: 'DELETE' }),

  // Email Desk
  triageEmail: (body: any) => fetchApi('/email-desk/triage', { method: 'POST', body: JSON.stringify(body) }),
  listEmails: () => fetchApi('/email-desk/messages'),
  approveEmail: (id: string) => fetchApi(`/email-desk/${id}/approve`, { method: 'POST' }),
};

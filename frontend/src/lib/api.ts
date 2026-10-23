const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocalhost
  ? import.meta.env.VITE_API_URL_LOCAL
  : import.meta.env.VITE_API_URL;

let accessToken: string | null = null;

export const setAccessToken = (token: string) => {
  accessToken = token;
  localStorage.setItem('access_token', token);
};

export const getAccessToken = () => {
  if (!accessToken) {
    accessToken = localStorage.getItem('access_token');
  }
  return accessToken;
};

export const clearAccessToken = () => {
  accessToken = null;
  localStorage.removeItem('access_token');
};

export const apiUploadsRequest = async (endpoint: string, options: RequestInit = {}) => {
  const token = getAccessToken();

  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAccessToken();
    // window.location.href = '/';
    // throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || 'Request failed');
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
  const token = getAccessToken();

  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearAccessToken();
    // window.location.href = '/';
    // throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    const raw = error?.message ?? error?.error ?? 'Request failed';
    const message = Array.isArray(raw) ? raw.join(' • ') : String(raw);
    const err = new Error(message) as Error & { status?: number; payload?: any };
    err.status = response.status;
    err.payload = error;
    throw err;
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const authAPI = {
  login: async (email: string, password: string, organizationSlug?: string) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(organizationSlug ? { organizationSlug } : {}) }),
    });
    return data;
  },

  forgotPassword: async (email: string) => {
    return apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  verifyCode: async (email: string, code: string) => {
    return apiRequest('/auth/verify-code', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
  },

  resetPassword: async (token: string, newPassword: string) => {
    return apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  },
};

export const usersAPI = {
  getProfile: async () => {
    return apiRequest('/users/profile');
  },

  getAll: async () => {
    return apiRequest('/users');
  },

  getById: async (id: string) => {
    return apiRequest(`/users/${id}`);
  },

  create: async (userData: any) => {
    return apiRequest('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  },

  update: async (id: string, userData: any) => {
    return apiRequest(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  },

  delete: async (id: string) => {
    return apiRequest(`/users/${id}`, {
      method: 'DELETE',
    });
  },

  updatePermissions: async (
    id: string,
    payload: { preset?: string; permissions?: Record<string, 'none' | 'read' | 'write'> },
  ) => {
    return apiRequest(`/users/${id}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};

export const missionsAPI = {
  getAll: async () => {
    return apiRequest('/missions');
  },

  getById: async (id: string) => {
    return apiRequest(`/missions/${id}`);
  },

  create: async (missionData: any) => {
    return apiRequest('/missions', {
      method: 'POST',
      body: JSON.stringify(missionData),
    });
  },

  update: async (id: string, missionData: any) => {
    return apiRequest(`/missions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(missionData),
    });
  },

  delete: async (id: string) => {
    return apiRequest(`/missions/${id}`, {
      method: 'DELETE',
    });
  },

  assign: async (id: string, userIds: string[]) => {
    return apiRequest(`/missions/${id}/assign`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  },

  bulkImport: async (formData: FormData) => {
    const token = getAccessToken();
    const response = await fetch(`${API_BASE_URL}/missions/bulk-import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Erreur lors de l\'import' }));
      throw new Error(error.message || 'Erreur lors de l\'import');
    }

    return response.json();
  },

  getAssignedUsers: async (id: string) => {
    return apiRequest(`/missions/${id}/planifiee-users`);
  },

  deleteAssignedUser: async (missionId: string, userId: string) => {
    return apiRequest(`/missions/${missionId}/assign/${userId}`, {
      method: 'DELETE',
    });
  },

  getAllUsers: async () => {
    return apiRequest('/missions/admin/all-users');
  },
};

export const reportsAPI = {
  getAll: async () => {
    return apiRequest('/reports');
  },

  getById: async (id: string) => {
    return apiRequest(`/reports/${id}`);
  },

  create: async (reportData: any) => {
    return apiRequest('/reports', {
      method: 'POST',
      body: JSON.stringify(reportData),
    });
  },

  update: async (id: string, reportData: any) => {
    return apiRequest(`/reports/${id}`, {
      method: 'PUT',
      body: JSON.stringify(reportData),
    });
  },

  delete: async (id: string) => {
    return apiRequest(`/reports/${id}`, {
      method: 'DELETE',
    });
  },
};

export const mailingListAPI = {
  getAll: async () => apiRequest('/mailing-list'),
  getMissionOptions: async () => apiRequest('/mailing-list/missions'),
  getByMission: async (missionId: string) => apiRequest(`/mailing-list/mission/${missionId}`),
  create: async (data: { email: string; name?: string; missionId: string }) =>
    apiRequest('/mailing-list', { method: 'POST', body: JSON.stringify(data) }),
  update: async (id: string, data: { email?: string; name?: string; missionId?: string }) =>
    apiRequest(`/mailing-list/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: async (id: string) =>
    apiRequest(`/mailing-list/${id}`, { method: 'DELETE' }),
  bulkCreate: async (missionId: string, entries: Array<{ email: string; name?: string }>) =>
    apiRequest('/mailing-list/bulk', { method: 'POST', body: JSON.stringify({ missionId, entries }) }),
};

export const visitsAPI = {
  getAll: async (missionId?: string) => {
    const url = missionId ? `/visits?missionId=${missionId}` : '/visits';
    return apiRequest(url);
  },

  getById: async (id: string) => {
    return apiRequest(`/visits/${id}`);
  },

  create: async (visitData: any) => {
    return apiRequest('/visits', {
      method: 'POST',
      body: JSON.stringify(visitData),
    });
  },

  update: async (id: string, visitData: any) => {
    return apiRequest(`/visits/${id}`, {
      method: 'PUT',
      body: JSON.stringify(visitData),
    });
  },

  delete: async (id: string) => {
    return apiRequest(`/visits/${id}`, {
      method: 'DELETE',
    });
  },

  generateReport: async (visitId: string, options?: { header?: string; footer?: string; notes?: string }) => {
    return apiRequest(`/visits/${visitId}/generate-report`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  // Server-authoritative SPS group commands. These endpoints own group IDs,
  // persistence and Prevention scheduling; the UI must not patch visit.photos.
  analysisGroups: {
    create: async (visitId: string, body: {
      requestId: string;
      imageUrls?: string[];
      imageReceipts?: string[];
      userDirectives?: string;
      comment?: string;
      customPromptIds?: string[];
    }) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    updateMany: async (visitId: string, groups: Array<{ groupId: string; observations?: string[]; recommendations?: string[]; references?: string[]; comment?: string }>) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups`, {
      method: 'PATCH', body: JSON.stringify({ groups }),
    }),
    reanalyze: async (visitId: string, groupId: string, body: {
      requestId: string;
      userDirectives?: string;
      customPromptIds?: string[];
    }) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/reanalyze`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    clarify: async (visitId: string, groupId: string, body: {
      requestId: string;
      detailImageUrls: string[];
      detailImageReceipts: string[];
      userDirectives?: string;
      customPromptIds?: string[];
    }) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/clarify`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    reanalyzeAll: async (visitId: string, body: {
      requestId: string;
      userDirectives?: string;
      customPromptIds?: string[];
    }) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups/reanalyze-all`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    attachPhotos: async (visitId: string, groupId: string, body: {
      imageUrls: string[];
      imageReceipts: string[];
      isDetailPhoto?: boolean;
      isReadabilityPhoto?: boolean;
      detailContext?: string;
    }) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/photos`, {
      method: 'POST', body: JSON.stringify(body),
    }),
    update: async (visitId: string, groupId: string, body: Record<string, unknown>) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),
    deletePhoto: async (visitId: string, groupId: string, photoId: string) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' }),
    delete: async (visitId: string, groupId: string) => apiRequest(`/visits/${encodeURIComponent(visitId)}/analysis-groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' }),
  },
};

export const activityLogsAPI = {
  getAll: async () => {
    return apiRequest('/activity-logs');
  },

  getByUserId: async (userId: string) => {
    return apiRequest(`/activity-logs?userId=${userId}`);
  },
};

export const dashboardAPI = {
  getStats: async () => {
    return apiRequest('/dashboard/stats');
  },

  getCoordinatorStats: async () => {
    return apiRequest('/dashboard/coordinator-stats');
  },

  getMonthlyMissions: async () => {
    return apiRequest('/dashboard/monthly-missions');
  },

  getStatusBreakdown: async () => {
    return apiRequest('/dashboard/status-breakdown');
  },
};

export type PreventionPreset =
  | 'ALL'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'CURRENT_QUARTER'
  | 'LAST_6_MONTHS'
  | 'CURRENT_YEAR'
  | 'LAST_12_MONTHS'
  | 'CUSTOM';

export interface PreventionQuery {
  preset?: PreventionPreset;
  from?: string;
  to?: string;
  missionType?: 'CSPS' | 'AEU' | 'DIVERS';
  missionId?: string;
  missionIds?: string[];
  chantierId?: string;
  clientKeys?: string[];
  categoryId?: string;
  categoryIds?: string[];
  riskLevel?: 'faible' | 'moyen' | 'eleve';
  severity?: 'faible' | 'moyen' | 'eleve' | 'critique';
  severities?: Array<'faible' | 'moyen' | 'eleve' | 'critique'>;
  status?: 'brouillon' | 'envoye' | 'valide' | 'refuse' | 'archive' | 'envoye_au_client' | 'annule';
  page?: number;
  limit?: number;
  sortBy?: 'businessDate' | 'score' | 'occurrenceCount' | 'riskLevel' | 'findingCount';
  sortOrder?: 'asc' | 'desc';
}

export type PreventionPhase = string;
export type PreventionPhaseOption = { value: string; label: string; custom: boolean };

type PreventionQueryParams = PreventionQuery;

const preventionQuery = (query: PreventionQueryParams = {}) => {
  const params = new URLSearchParams();
  const normalized = { ...query } as Record<string, unknown>;
  if (Array.isArray(normalized.missionIds)) delete normalized.missionId;
  if (Array.isArray(normalized.categoryIds)) delete normalized.categoryId;
  if (Array.isArray(normalized.severities)) delete normalized.severity;
  Object.entries(normalized).forEach(([key, value]) => {
    if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return;
    params.set(key, Array.isArray(value) ? value.join(',') : String(value));
  });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
};

export const preventionAPI = {
  dashboard: (query: PreventionQuery = {}) => apiRequest(`/prevention/dashboard${preventionQuery(query)}`),
  findings: (query: PreventionQuery = {}) => apiRequest(`/prevention/findings${preventionQuery(query)}`),
  recommendations: (query: PreventionQuery = {}) => apiRequest(`/prevention/recommendations${preventionQuery(query)}`),
  categories: () => apiRequest('/prevention/categories'),
  phaseCatalog: () => apiRequest('/prevention/visits/phases') as Promise<PreventionPhaseOption[]>,
  groupStatus: (visitId: string, groupId: string) => apiRequest(`/prevention/visits/${encodeURIComponent(visitId)}/groups/${encodeURIComponent(groupId)}/status`),
  updateVisitGroupPhase: (visitId: string, groupId: string, selection: { phase: string } | { customPhaseLabel: string }) => apiRequest(`/prevention/visits/${encodeURIComponent(visitId)}/groups/${encodeURIComponent(groupId)}/phase`, {
    method: 'PATCH',
    body: JSON.stringify(selection),
  }),
  trends: (query: PreventionQuery = {}) => apiRequest(`/prevention/trends${preventionQuery(query)}`),
  references: (query: PreventionQuery = {}) => apiRequest(`/prevention/references${preventionQuery(query)}`),
  rebuildPreview: (scope: Pick<PreventionQuery, 'missionId' | 'missionIds' | 'clientKeys'> = {}) => apiRequest(`/prevention/rebuild/preview${preventionQuery(scope)}`),
  rebuild: (previewToken?: string, scope: Pick<PreventionQuery, 'missionId' | 'missionIds' | 'clientKeys'> = {}) => {
    const normalizedScope = { ...scope };
    if (Array.isArray(normalizedScope.missionIds)) normalizedScope.missionId = undefined;
    return apiRequest('/prevention/rebuild', { method: 'POST', body: JSON.stringify({ previewToken, ...normalizedScope }) });
  },
  job: (id: string) => apiRequest(`/prevention/jobs/${encodeURIComponent(id)}`),
  budgets: () => apiRequest('/prevention/budgets'),
  budgetClients: () => apiRequest('/prevention/budgets/clients'),
  budgetScope: (query: Pick<PreventionQuery, 'preset' | 'from' | 'to' | 'categoryId' | 'categoryIds' | 'severity' | 'severities' | 'missionId' | 'missionIds'> & { clientKeys?: string[] }) => apiRequest(`/prevention/budgets/scope${preventionQuery(query)}`),
  budgetMaterialized: (query: Pick<PreventionQuery, 'preset' | 'from' | 'to' | 'categoryId' | 'categoryIds' | 'severity' | 'severities' | 'missionId' | 'missionIds'> & { clientKeys?: string[] }) => apiRequest(`/prevention/budgets/materialized${preventionQuery(query)}`),
  calculateBudgetScope: (query: Pick<PreventionQuery, 'preset' | 'from' | 'to' | 'categoryId' | 'categoryIds' | 'severity' | 'severities' | 'missionId' | 'missionIds'> & { clientKeys?: string[]; adminPrompt?: string; calculationMode?: 'CURRENT_YEAR' | 'GLOBAL_YEARLY' }) => apiRequest('/prevention/budgets/scope', { method: 'POST', body: JSON.stringify(query) }),
  budgetPreview: (payload: { mode: 'FILTERED' | 'CURRENT_YEAR' | 'GLOBAL_YEARLY'; preset?: PreventionPreset; from?: string; to?: string; categoryId?: string; categoryIds?: string[]; severity?: string; severities?: string[]; missionId?: string; missionIds?: string[]; clientKeys?: string[] }) => apiRequest('/prevention/budgets/preview', { method: 'POST', body: JSON.stringify(payload) }),
  budgetCommand: (payload: { mode: 'FILTERED' | 'CURRENT_YEAR' | 'GLOBAL_YEARLY'; confirmationToken: string; preset?: PreventionPreset; from?: string; to?: string; categoryId?: string; categoryIds?: string[]; severity?: string; severities?: string[]; missionId?: string; missionIds?: string[]; clientKeys?: string[]; adminPrompt?: string }) => apiRequest('/prevention/budgets/command', { method: 'POST', body: JSON.stringify(payload) }),
  budget: (id: string, query: Pick<PreventionQuery, 'missionId' | 'missionIds' | 'categoryId' | 'categoryIds' | 'severity' | 'severities'> & { clientKeys?: string[] } = {}) => apiRequest(`/prevention/budgets/${encodeURIComponent(id)}${preventionQuery(query)}`),
  createBudget: (payload: Record<string, unknown>) => apiRequest('/prevention/budgets', { method: 'POST', body: JSON.stringify(payload) }),
  updateBudget: (budgetId: string, payload: Record<string, unknown>) => apiRequest(`/prevention/budgets/${encodeURIComponent(budgetId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateBudgetItem: (budgetId: string, itemId: string, payload: Record<string, unknown>) => apiRequest(`/prevention/budgets/${encodeURIComponent(budgetId)}/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  recalculateBudget: (budgetId: string, payload: Record<string, unknown>) => apiRequest(`/prevention/budgets/${encodeURIComponent(budgetId)}/recalculate`, { method: 'POST', body: JSON.stringify(payload) }),
  recalculateBudgetItem: (budgetId: string, itemId: string, payload: Record<string, unknown>) => apiRequest(`/prevention/budgets/${encodeURIComponent(budgetId)}/items/${encodeURIComponent(itemId)}/recalculate`, { method: 'POST', body: JSON.stringify(payload) }),
  recalculateMaterializedBudgetItem: (scenarioId: string, itemId: string, payload: Record<string, unknown>) => apiRequest(`/prevention/budgets/materialized/${encodeURIComponent(scenarioId)}/items/${encodeURIComponent(itemId)}/recalculate`, { method: 'POST', body: JSON.stringify(payload) }),
  updateMaterializedBudgetItem: (scenarioId: string, itemId: string, payload: Record<string, unknown>) => apiRequest(`/prevention/budgets/materialized/${encodeURIComponent(scenarioId)}/items/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  budgetCatalog: () => apiRequest('/prevention/budget-catalog'),
  createBudgetCatalog: (payload: Record<string, unknown>) => apiRequest('/prevention/budget-catalog', { method: 'POST', body: JSON.stringify(payload) }),
  updateBudgetCatalogStatus: (id: string, isActive: boolean) => apiRequest(`/prevention/budget-catalog/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  budgetJob: (id: string) => apiRequest(`/prevention/budget-jobs/${encodeURIComponent(id)}`),
};

export const publicOrgAPI = {
  getBySlug: async (slug: string, options: RequestInit = {}) => {
    return apiRequest(`/public/organizations/by-slug/${encodeURIComponent(slug)}`, options);
  },
};

export const currentOrgAPI = {
  get: async () => apiRequest('/organizations/current'),
  update: async (data: { cguContent?: string; privacyContent?: string }) =>
    apiRequest('/organizations/current', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  validateLegalDocuments: async (data: { cguContent: string; privacyContent: string }) =>
    apiRequest('/organizations/current/legal-validation', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

export const organizationsAPI = {
  getAll: async () => apiRequest('/hyper-admin/organizations'),
  getReportBtpLegalDocs: async () => apiRequest('/hyper-admin/organizations/reportbtp/legal-docs'),
  updateReportBtpLegalDocs: async (data: { cguContent?: string; privacyContent?: string }) =>
    apiRequest('/hyper-admin/organizations/reportbtp/legal-docs', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getById: async (id: string) => apiRequest(`/hyper-admin/organizations/${id}`),
  create: async (data: any) =>
    apiRequest('/hyper-admin/organizations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: async (id: string, data: any) =>
    apiRequest(`/hyper-admin/organizations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  remove: async (id: string) =>
    apiRequest(`/hyper-admin/organizations/${id}`, { method: 'DELETE' }),
  preventionRecoveryStatuses: async () =>
    apiRequest('/hyper-admin/organizations/prevention-recovery/statuses'),
  preventionRecoveryPreview: async (id: string) =>
    apiRequest(`/hyper-admin/organizations/${id}/prevention-recovery/preview`),
  preventionRecoveryConfirm: async (id: string, confirmationToken: string, immediateRequested: boolean) =>
    apiRequest(`/hyper-admin/organizations/${id}/prevention-recovery`, {
      method: 'POST',
      body: JSON.stringify({ confirmationToken, immediateRequested }),
    }),
  preventionRecoveryStatus: async (id: string) =>
    apiRequest(`/hyper-admin/organizations/${id}/prevention-recovery`),
  uploadLogo: async (id: string, file: File) => {
    const token = getAccessToken();
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE_URL}/hyper-admin/organizations/${id}/logo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(error.message || 'Upload failed');
    }
    return response.json();
  },
  uploadBackground: async (id: string, file: File) => {
    const token = getAccessToken();
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE_URL}/hyper-admin/organizations/${id}/background`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(error.message || 'Upload failed');
    }
    return response.json();
  },
};

export const hyperAdminAPI = {
  dashboard: async () => apiRequest('/hyper-admin/dashboard'),
  users: async () => apiRequest('/hyper-admin/users'),
  createUser: async (data: any) =>
    apiRequest('/hyper-admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  orgUsers: async (orgId: string) =>
    apiRequest(`/hyper-admin/organizations/${orgId}/users`),
  createOrgUser: async (orgId: string, data: any) =>
    apiRequest(`/hyper-admin/organizations/${orgId}/users`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateUser: async (id: string, data: any) =>
    apiRequest(`/hyper-admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteUser: async (id: string) =>
    apiRequest(`/hyper-admin/users/${id}`, { method: 'DELETE' }),
  updateUserPermissions: async (
    id: string,
    payload: { preset?: string; permissions?: Record<string, 'none' | 'read' | 'write'> },
  ) =>
    apiRequest(`/users/${id}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
};

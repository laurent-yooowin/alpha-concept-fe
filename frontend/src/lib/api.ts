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

  const headers: HeadersInit = {
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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

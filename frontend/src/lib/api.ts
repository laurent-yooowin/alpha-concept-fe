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
    window.location.href = '/';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || 'Request failed');
  }

  return response.json();
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
    window.location.href = '/';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || 'Request failed');
  }

  return response.json();
};

export const authAPI = {
  login: async (email: string, password: string) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return data;
  },

  forgotPassword: async (email: string) => {
    return apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword: async (token: string, password: string) => {
    return apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
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
    return apiRequest('/auth/register', {
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

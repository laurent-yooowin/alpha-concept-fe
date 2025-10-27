import { api } from './api';

export type ReportStatus = 'brouillon' | 'envoye' | 'valide' | 'rejete' | 'archive';

export interface Report {
  id: string;
  missionId: string;
  visitId?: string;
  userId: string;
  title: string;
  content: string;
  status: ReportStatus;
  conformityPercentage: number;
  sentAt?: string;
  recipientEmail?: string;
  createdAt: string;
  updatedAt: string;
  mission?: any;
  visit?: any;
}

export interface CreateReportData {
  missionId: string;
  visitId?: string;
  title: string;
  content: string;
  header: string;
  footer: string;
  status?: ReportStatus;
  conformityPercentage?: number;
  recipientEmail?: string;
}

export interface UpdateReportData {
  title?: string;
  content?: string;
  header: string;
  footer: string;
  status?: ReportStatus;
  conformityPercentage?: number;
  recipientEmail?: string;
}

export const reportService = {
  async getReports(status?: ReportStatus) {
    const url = status ? `/reports?status=${status}` : '/reports';
    return api.get<Report[]>(url);
  },

  async getReport(id: string) {
    return api.get<Report>(`/reports/${id}`);
  },

  async createReport(data: CreateReportData) {
    return api.post<Report>('/reports', data);
  },

  async updateReport(id: string, data: UpdateReportData) {
    return api.put<Report>(`/reports/${id}`, data);
  },

  async deleteReport(id: string) {
    return api.delete(`/reports/${id}`);
  },

  async getReportCounts() {
    return api.get<{ [key: string]: number }>('/reports/counts');
  },

  async sendReportEmail(id: string, email: string, subject: string, message: string) {
    return api.post(`/reports/${id}/send`, { email, subject, message });
  },

  async validateReport(id: string) {
    return api.put<Report>(`/reports/${id}`, { status: 'valide' as ReportStatus });
  },
};

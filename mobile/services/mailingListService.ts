import { apiRequest } from './api';

export interface MailingListEntry {
  id: string;
  email: string;
  name: string | null;
  missionId?: string | null;
}

export const mailingListService = {
  async getAll() {
    return apiRequest<MailingListEntry[]>('/mailing-list');
  },

  async getByMission(missionId: string) {
    return apiRequest<MailingListEntry[]>(`/mailing-list/mission/${missionId}`);
  },

  async create(payload: { email: string; name?: string; missionId?: string | null }) {
    return apiRequest<MailingListEntry>('/mailing-list', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getCcEmails(missionId?: string): Promise<string[]> {
    const res = missionId
      ? await this.getByMission(missionId)
      : await apiRequest<MailingListEntry[]>('/mailing-list');
    if (res?.data && Array.isArray(res.data)) {
      return res.data.map((e) => e.email).filter(Boolean);
    }
    return [];
  },
};

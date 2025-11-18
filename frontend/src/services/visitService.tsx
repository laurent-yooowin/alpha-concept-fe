import { apiRequest } from '../lib/api';

export const visitService = {
    async getVisit(id?: string) {
        const url = id ? `/visits/${id}` : '/visits';

        return apiRequest(url, { method: 'GET' });

    },
    async update(id: string, visitData: any){
        return apiRequest(`/visits/${id}`, {
          method: 'PUT',
            body: JSON.stringify(visitData),
        });
      },
};

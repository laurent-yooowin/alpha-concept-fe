import { apiRequest } from '../lib/api';

export const filesService = {
    async downloadFile(publicUrl: string, folder: string, isBase64 = false) {
        const url = '/upload/download';
        const data = {
            publicUrl: publicUrl,
            folder: folder,
            isBase64: isBase64 || false,
        }
        return apiRequest(url, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
};

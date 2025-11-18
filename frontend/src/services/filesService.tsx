import { apiRequest } from '../lib/api';

export const filesService = {
    async downloadFile(publicUrl, folder, isBase64) {
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

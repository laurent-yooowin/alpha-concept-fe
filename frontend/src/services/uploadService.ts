import { apiUploadsRequest } from '../lib/api';

export interface UploadResult {
  url?: string;
  key?: string;
}

export const uploadService = {
  async uploadVisitPhotos(files: File[]): Promise<UploadResult[]> {
    const formData = new FormData();
    files.forEach((file, index) => {
      const fileName = `photo_${index}_${Date.now()}.jpg`;
      formData.append('photos', file, fileName);
    });

    const response = await apiUploadsRequest('/upload/visit-photos', {
      method: 'POST',
      body: formData,
    });

    if (response?.data && Array.isArray(response.data)) {
      return response.data;
    }
    if (Array.isArray(response)) {
      return response;
    }
    return response?.data ? [response.data] : [];
  },

  async uploadSingleFile(file: File, fileName: string): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file', file, fileName);

    const response = await apiUploadsRequest('/upload/single', {
      method: 'POST',
      body: formData,
    });

    return response?.data || response;
  },

  async deletePhotoByUrl(url: string): Promise<void> {
    await apiUploadsRequest('/upload/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  },
};

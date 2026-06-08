import { api, apiRequest } from './api';
import { Platform } from 'react-native';

export interface UploadResult {
  data: {
    url?: string;
    key?: string;
  }
}
export interface DeleteResponse {
  fileName?: string;
  message?: string;
}

export interface UploadResponse {
  success: boolean;
  message: string;
  data: UploadResult | UploadResult[];
}

export interface DownloadFileResponse {
  data: {
    base64?: string;
    contentType?: string;
  };
}

const imageContentTypeFromFileName = (fileName: string) => {
  const cleanName = fileName.split('?')[0].toLowerCase();
  if (cleanName.endsWith('.avif')) return 'image/avif';
  if (cleanName.endsWith('.webp')) return 'image/webp';
  if (cleanName.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
};

export const uploadService = {

  async deletePhotoByUrl(url: string): Promise<DeleteResponse> {
    if (!url || url.trim() === '' || !url.includes('https://')) {
      throw new Error('Aucune url fourni');
    }

    const response = await api.post<DeleteResponse>('/upload/delete', { url });

    if (!response || !response.data) {
      throw new Error('Réponse vide du serveur.');
    }

    return response.data;
  },

  async uploadSingleFile(file: Blob | string, fileName: string): Promise<UploadResult> {
    const formData = new FormData();

    if (typeof file === 'string' && Platform.OS !== 'web') {
      // Mobile: file is a URI
      formData.append('file', {
        uri: file,
        type: imageContentTypeFromFileName(fileName),
        name: fileName,
      } as any);
    } else {
      // Web: file is a Blob
      formData.append('file', file as Blob, fileName);
    }

    const response = await api.post<UploadResponse>('/upload/single', formData);

    if (!response.data || response.data?.data && Array.isArray(response.data.data)) {
      throw new Error(response.error || 'Upload failed');
    }

    return response.data;
  },

  async uploadReportsFile(file: Blob | string, fileName: string): Promise<UploadResult> {
    const formData = new FormData();

    if (typeof file === 'string' && Platform.OS !== 'web') {
      // Mobile: file is a URI
      formData.append('file', {
        uri: file,
        type: 'application/pdf',
        name: fileName,
      } as any);
    } else {
      // Web: file is a Blob
      formData.append('file', file as Blob, fileName);
    }

    const response = await api.post<UploadResponse>('/upload/reports_file', formData);

    if (!response.data || response.data?.data && Array.isArray(response.data.data)) {
      throw new Error(response.error || 'Upload failed');
    }

    return response.data;
  },

  async uploadMultipleFiles(files: (Blob | string)[], fileNames?: string[]): Promise<UploadResult[]> {
    const formData = new FormData();

    files.forEach((file, index) => {
      const fileName = fileNames?.[index] || `file_${index}_${Date.now()}`;

      if (typeof file === 'string' && Platform.OS !== 'web') {
        // Mobile: file is a URI
        formData.append('files', {
          uri: file,
          type: imageContentTypeFromFileName(fileName),
          name: fileName,
        } as any);
      } else {
        // Web: file is a Blob
        formData.append('files', file as Blob, fileName);
      }
    });

    const response = await api.post<UploadResponse>('/upload/multiple', formData);

    if (!response.data || response.data?.data && !Array.isArray(response.data.data)) {
      throw new Error(response.error || 'Upload failed');
    }

    return response.data;
  },

  async uploadVisitPhotos(files: (Blob | string)[]): Promise<UploadResult[]> {
    const formData = new FormData();

    files.forEach((file, index) => {
      const fileName = `photo_${index}_${Date.now()}.jpg`;

      if (typeof file === 'string' && Platform.OS !== 'web') {
        // Mobile: file is a URI
        formData.append('photos', {
          uri: file,
          type: 'image/jpeg',
          name: fileName,
        } as any);
      } else {
        // Web: file is a Blob
        formData.append('photos', file as Blob, fileName);
      }
    });

    const response = await api.post<UploadResponse>('/upload/visit-photos', formData);

    if (!response.data || response.data?.data && !Array.isArray(response.data.data)) {
      throw new Error(response.error || 'Upload failed');
    }

    return response.data;
  },
  async downloadFile(publicUrl: string, folder: string, isBase64: boolean) {
    const url = '/upload/download';
    const data = {
      publicUrl: publicUrl,
      folder: folder,
      isBase64: isBase64 || false,
    }
    return await apiRequest<DownloadFileResponse>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
};

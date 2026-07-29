import { api, apiRequest, getApiBaseUrl } from './api';
import { tokenStorage } from './tokenStorage';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

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
    if (typeof file === "string" && Platform.OS !== "web") {
      const token = await tokenStorage.getToken();
      const result = await FileSystem.uploadAsync(
        `${getApiBaseUrl()}/upload/reports_file`,
        file,
        {
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "file",
          mimeType: "application/pdf",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );

      let payload: any = {};
      try {
        payload = result.body ? JSON.parse(result.body) : {};
      } catch {
        throw new Error(`Réponse invalide du serveur (HTTP ${result.status})`);
      }

      if (result.status < 200 || result.status >= 300) {
        const message = Array.isArray(payload?.message)
          ? payload.message.join(" • ")
          : payload?.message || payload?.error || `Upload refusé (HTTP ${result.status})`;
        throw new Error(message);
      }

      return payload as UploadResult;
    }

    const formData = new FormData();
    formData.append("file", file as Blob, fileName);
    const response = await api.post<UploadResponse>("/upload/reports_file", formData);

    if (!response.data || response.data?.data && Array.isArray(response.data.data)) {
      throw new Error(response.error || "Upload failed");
    }

    return response.data as unknown as UploadResult;
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

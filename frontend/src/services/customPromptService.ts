import { apiRequest } from '../lib/api';

export type MissionType = 'CSPS' | 'AEU' | 'Divers';

export interface CustomPrompt {
  id: string;
  name: string;
  missionType: MissionType;
  content: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomPromptInput {
  name: string;
  missionType: MissionType;
  content: string;
  displayOrder?: number;
  isActive?: boolean;
}

export const customPromptService = {
  getAvailable: (missionType: string) =>
    apiRequest('/custom-prompts?missionType=' + encodeURIComponent(missionType)) as Promise<CustomPrompt[]>,

  getAllForAdmin: (missionType?: string) =>
    apiRequest('/custom-prompts/admin' + (missionType ? '?missionType=' + encodeURIComponent(missionType) : '')) as Promise<CustomPrompt[]>,

  create: (input: CustomPromptInput) =>
    apiRequest('/custom-prompts', {
      method: 'POST',
      body: JSON.stringify(input),
    }) as Promise<CustomPrompt>,

  update: (id: string, input: Partial<CustomPromptInput>) =>
    apiRequest('/custom-prompts/' + id, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }) as Promise<CustomPrompt>,

  deactivate: (id: string) =>
    apiRequest('/custom-prompts/' + id, { method: 'DELETE' }),
};

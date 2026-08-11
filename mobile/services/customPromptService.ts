import { api } from './api';

export interface CustomPrompt {
  id: string;
  name: string;
  missionType: 'CSPS' | 'AEU' | 'Divers';
  content: string;
  displayOrder: number;
  isActive: boolean;
}

export const customPromptService = {
  getAvailable(missionType: string) {
    return api.get<CustomPrompt[]>(
      '/custom-prompts?missionType=' + encodeURIComponent(missionType),
    );
  },
};

import { apiRequest } from './api';

export interface OrganizationBranding {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  backgroundImageUrl?: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  loginTitle?: string | null;
  loginContent?: string | null;
}

export const organizationService = {
  async getPublicBySlug(slug: string) {
    return apiRequest<OrganizationBranding>(
      `/public/organizations/by-slug/${encodeURIComponent(slug)}`,
    );
  },

  async getCurrent() {
    return apiRequest<OrganizationBranding | null>('/organizations/current');
  },
};

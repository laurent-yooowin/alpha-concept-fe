import type { PreventionQuery } from '../../lib/api';

export const allPreventionFilters = (): PreventionQuery => ({
  preset: 'ALL',
  missionIds: [],
  clientKeys: [],
  categoryIds: [],
  severities: [],
  page: 1,
});

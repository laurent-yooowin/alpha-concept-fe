import AsyncStorage from '@react-native-async-storage/async-storage';

export const DEFAULT_ORG_SLUG =
  process.env.EXPO_PUBLIC_DEFAULT_ORG_SLUG?.trim() || 'alphaconcept';

export const LAST_ORG_SLUG_KEY = 'last_org_slug';
export const LAST_ORG_ID_KEY = 'last_org_id';

export function normalizeOrgSlug(slug?: string | string[] | null) {
  const value = Array.isArray(slug) ? slug[0] : slug;
  return value?.trim().toLowerCase() || '';
}

export async function getStoredOrganizationSlug() {
  const stored = normalizeOrgSlug(await AsyncStorage.getItem(LAST_ORG_SLUG_KEY));
  return stored || DEFAULT_ORG_SLUG;
}

export async function persistOrganizationSlug(slug?: string | null) {
  const normalized = normalizeOrgSlug(slug);
  if (!normalized) return;
  await AsyncStorage.setItem(LAST_ORG_SLUG_KEY, normalized);
}

export async function persistOrganizationId(id?: string | null) {
  if (!id) return;
  await AsyncStorage.setItem(LAST_ORG_ID_KEY, id);
}

export function loginRoute(slug: string) {
  return {
    pathname: '/auth/login',
    params: { organizationSlug: normalizeOrgSlug(slug) || DEFAULT_ORG_SLUG },
  } as const;
}

export async function organizationStorageKey(baseKey: string) {
  const slug = await getStoredOrganizationSlug();
  return `${baseKey}:${slug}`;
}

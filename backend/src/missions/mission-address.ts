/** Only removes the known trailing token introduced by the legacy CSV/XLSX import. */
export function cleanLegacyMissionAddress(value: string | null | undefined): string {
  return String(value ?? '').replace(/(?:\s+undefined)+\s*$/i, '').trim();
}

export function importedMissionAddress(city: unknown, postalCode: unknown): string {
  const place = cleanLegacyMissionAddress(String(city ?? ''));
  const postal = String(postalCode ?? '').trim();
  return [place, /^(undefined|null)$/i.test(postal) ? '' : postal].filter(Boolean).join(' ');
}

export function normalizedFilterSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/œ/g, 'oe').replace(/æ/g, 'ae').trim();
}

export function filterOptionsBySearch<T extends { label: string }>(options: T[], search: string): T[] {
  const query = normalizedFilterSearch(search);
  return query ? options.filter((option) => normalizedFilterSearch(option.label).includes(query)) : options;
}

export function selectAllVisibleKeys<T extends { key: string; label: string }>(
  options: T[], selectedKeys: string[], search: string, limit: number,
): string[] | null {
  if (!normalizedFilterSearch(search)) {
    return options.slice(0, limit).map((option) => option.key);
  }
  const visibleKeys = filterOptionsBySearch(options, search).map((option) => option.key);
  if (!visibleKeys.length) return null;
  const combined = [...new Set([...selectedKeys, ...visibleKeys])];
  return combined.length <= limit ? combined : null;
}

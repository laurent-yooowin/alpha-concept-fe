const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR').replace(/œ/g, 'oe').replace(/æ/g, 'ae').trim();

export function phaseSearchMatches(label: string, search: string): boolean {
  const query = normalize(search);
  return !query || normalize(label).includes(query);
}

export function filterPhaseOptions<T extends { label: string; value: string }>(options: T[], search: string, selected?: string | null): T[] {
  return options.filter((option) => option.value === selected || phaseSearchMatches(option.label, search));
}

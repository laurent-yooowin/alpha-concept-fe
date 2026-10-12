export class PreventionSourceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreventionSourceValidationError';
  }
}

export function normalizePreventionList(value: unknown, maxItems = 100, maxLength = 10_000): string[] {
  if (value === null || value === undefined || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  if (values.length > maxItems) throw new PreventionSourceValidationError('Too many prevention analysis items');
  const result: string[] = [];
  for (const item of values) {
    if (typeof item !== 'string') throw new PreventionSourceValidationError('Prevention analysis items must be strings');
    if (item.length > maxLength) throw new PreventionSourceValidationError('Prevention analysis item is too long');
    const text = String(item)
      .replace(/\r/g, '')
      .replace(/[ \t]+(?=[•▪◦]\s*)/g, '\n')
      .replace(/[ \t]+(?=\d{1,2}[.)]\s+[A-ZÀ-Ÿ])/g, '\n')
      .replace(/[ \t]+(?=(?:dangers?|risques?)\s*:)/gi, '\n');
    for (const rawLine of text.split(/\n+/)) {
      const line = rawLine
        .replace(/^\s*(?:[-*•▪◦]+|\d{1,2}[.)])\s*/, '')
        .replace(/^\[?\s*(?:anomalie|constat|observation|point)\s*(?:\d+|x)?\s*\]?\s*[:.\-–—]?\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!line) continue;
      if (/^(?:danger|dangers|risque|risques)\s*:/i.test(line) && result.length > 0) {
        result[result.length - 1] += `\n${line}`;
      } else {
        result.push(line);
      }
      if (result.length > maxItems) throw new PreventionSourceValidationError('Too many normalized prevention items');
    }
  }
  return result;
}

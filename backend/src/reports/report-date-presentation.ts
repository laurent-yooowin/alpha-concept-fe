export function formatReportDate(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris',
  }).format(date);
}

export function withoutLegacyGeneratedHeaderDate(header: string): string {
  if (!/^RAPPORT DE VISITE SPS(?:\r?\n|$)/.test(header)) return header;
  return header.split(/\r?\n/)
    .filter((line) => !/^DATE:\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/i.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function withoutLegacyGeneratedFooterDate(footer: string): string {
  if (!/^CONCLUSION:(?:\r?\n|$)/.test(footer)) return footer;
  return footer.split(/\r?\n/)
    .filter((line) => !/^Date:\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/i.test(line.trim()))
    .join('\n')
    .trimEnd();
}

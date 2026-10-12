export function formatReportDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-');
      return `${day}/${month}/${year}`;
    }
  }
  const date = new Date(value);
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

export function withReportDatesAfterLocation(
  header: string,
  dates: Array<{ label: string; value: string }>,
): string {
  const dateLines = dates.map(({ label, value }) => `${label} : ${value || '—'}`);
  if (!dateLines.length) return header;
  const { before, after } = splitReportHeaderAtDates(header);
  return [before, ...dateLines, after].filter(Boolean).join('\n');
}

function splitReportHeaderAtDates(header: string): { before: string; after: string } {
  const lines = header ? header.split(/\r?\n/) : [];
  const locationLine = lines.findIndex((line) => /^LIEU\s*:/i.test(line.trim()));
  const coordinatorLine = lines.findIndex((line) => /^COORDONNATEUR\s*:/i.test(line.trim()));
  const insertAt = locationLine >= 0 ? locationLine + 1 : coordinatorLine >= 0 ? coordinatorLine : 0;
  return { before: lines.slice(0, insertAt).join('\n'), after: lines.slice(insertAt).join('\n') };
}

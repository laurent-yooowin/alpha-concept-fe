export interface ReportPhotoEditSource {
  id?: string;
  groupId?: string;
  s3Url?: string;
  comment?: unknown;
  analysis?: {
    riskLevel?: unknown;
    observation?: unknown;
    recommendation?: unknown;
    references?: unknown;
  } | null;
}

export interface ChangedReportGroup {
  groupId: string;
  observations?: string[];
  recommendations?: string[];
  references?: string[];
  comment?: string;
}

const textList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' && value ? [value] : [];
};

const firstEntryByGroup = (photos: ReportPhotoEditSource[]): Map<string, ReportPhotoEditSource> => {
  const groups = new Map<string, ReportPhotoEditSource>();
  for (const photo of photos) {
    const groupId = photo.groupId || photo.id;
    if (groupId && !groups.has(groupId)) groups.set(groupId, photo);
  }
  return groups;
};

export function changedReportGroups(originalPhotos: ReportPhotoEditSource[], editedPhotos: ReportPhotoEditSource[]): ChangedReportGroup[] {
  const originalGroups = firstEntryByGroup(originalPhotos);
  const editedGroups = firstEntryByGroup(editedPhotos);
  const changes: ChangedReportGroup[] = [];
  for (const [groupId, edited] of editedGroups) {
    const original = originalGroups.get(groupId);
    if (!original) continue;
    const change: ChangedReportGroup = { groupId };
    if (edited.analysis) {
      const fields = [
        ['observation', 'observations'],
        ['recommendation', 'recommendations'],
        ['references', 'references'],
      ] as const;
      for (const [source, target] of fields) {
        const before = textList(original.analysis?.[source]);
        const after = textList(edited.analysis[source]);
        if (JSON.stringify(before) !== JSON.stringify(after)) change[target] = after;
      }
    }
    const beforeComment = typeof original.comment === 'string' ? original.comment : '';
    const afterComment = typeof edited.comment === 'string' ? edited.comment : '';
    if (beforeComment !== afterComment) change.comment = afterComment;
    if (Object.keys(change).length > 1) changes.push(change);
  }
  return changes;
}

export function generateEditedReportContent(photos: ReportPhotoEditSource[]): string {
  let content = 'OBSERVATIONS PRINCIPALES:\n';
  photos.forEach((photo, index) => {
    const riskLevel = typeof photo.analysis?.riskLevel === 'string' ? photo.analysis.riskLevel : '';
    const riskLabels: Record<string, string> = { eleve: 'HIGH', moyen: 'MEDIUM', faible: 'LOW' };
    const riskLabel = riskLabels[riskLevel] || riskLevel.toUpperCase();
    content += '━'.repeat(25) + '\n';
    content += `Photo ${index + 1} - Niveau de risque: ${riskLabel}\n`;
    content += `📸 Photo: ${photo.s3Url || ''}\n\n`;
    content += 'Observations:\n';
    content += textList(photo.analysis?.observation).map((item) => `• ${item}`).join('\n') + '\n\n';
    content += 'Recommandations:\n';
    content += textList(photo.analysis?.recommendation).map((item) => `• ${item}`).join('\n') + '\n\n';
    content += '🏛️ Références:\n';
    content += textList(photo.analysis?.references).map((item) => `• ${item}`).join('\n') + '\n\n';
    content += '💬 Commentaires du coordonnateur:\n';
    content += (typeof photo.comment === 'string' ? photo.comment : '') + '\n\n';
  });
  return content;
}

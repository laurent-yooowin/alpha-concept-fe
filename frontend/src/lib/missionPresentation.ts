export function cleanMissionAddress(value: string | null | undefined): string {
  return String(value ?? '').replace(/(?:\s+undefined)+\s*$/i, '').trim();
}

export function formatMissionDate(value: string | Date | null | undefined): string {
  if (!value) return 'Date non renseignée';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date non renseignée' : date.toLocaleDateString('fr-FR');
}

export function missionStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    en_attente: 'En attente',
    planifiee: 'Planifié',
    assignee: 'Assigné',
    en_cours: 'En cours',
    terminee: 'Terminé',
    validee: 'Validé',
    archivee: 'Archivé',
    refusee: 'Refusé',
    annulee: 'Annulé',
  };
  return labels[status] || status;
}

export function missionAttributionKind(mission: {
  assigned?: boolean;
  userId?: string | null;
  user?: { role?: string } | null;
}, currentUser?: { id?: string; role?: string } | null): 'assignee' | 'affectee' | 'non_affectee' {
  if (mission.assigned) return 'assignee';
  const coordinator = mission.user?.role === 'ROLE_USER'
    || (currentUser?.role === 'ROLE_USER' && mission.userId === currentUser.id);
  return coordinator ? 'affectee' : 'non_affectee';
}

export function missionAttributionLabel(
  mission: Parameters<typeof missionAttributionKind>[0],
  currentUser?: Parameters<typeof missionAttributionKind>[1],
): string {
  const kind = missionAttributionKind(mission, currentUser);
  return kind === 'assignee' ? 'Assigné via attribution'
    : kind === 'affectee' ? 'Affecté au coordonnateur' : 'Non affecté';
}

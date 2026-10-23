export interface SearchableMission {
  title?: string | null;
  client?: string | null;
  location?: string | null;
  refClient?: string | null;
  refBusiness?: string | null;
  date?: string | null;
  status?: string | null;
}

const normalizeSearch = (value: string | null | undefined) =>
  (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR')
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').trim();

function matchesStatus(mission: SearchableMission, filter: string, today: Date): boolean {
  if (filter === 'toutes') return true;
  if (filter === 'planifiees') return mission.status === 'planifiees';

  const missionDate = mission.date ? new Date(mission.date) : null;
  const dateLabel = missionDate && !Number.isNaN(missionDate.getTime())
    ? missionDate.toLocaleDateString()
    : null;

  if (filter === 'aujourdhui') {
    return mission.status === 'aujourdhui' || dateLabel === today.toLocaleDateString();
  }
  if (filter === 'en_retard') {
    return mission.status === 'en_retard' || Boolean(dateLabel && dateLabel > today.toLocaleDateString());
  }
  return false;
}

export function filterMissions<T extends SearchableMission>(
  missions: readonly T[],
  filter: string,
  search: string,
  today: Date = new Date(),
): T[] {
  const query = normalizeSearch(search);
  return missions.filter((mission) => {
    if (!matchesStatus(mission, filter, today)) return false;
    if (!query) return true;
    return [mission.title, mission.client, mission.location, mission.refClient, mission.refBusiness]
      .some((value) => normalizeSearch(value).includes(query));
  });
}

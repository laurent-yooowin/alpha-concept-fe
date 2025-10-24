export const getMissionStatusInfo = (status: string) => {
  switch (status) {
    case 'planifiee':
      return {
        label: 'Planifiée',
        color: '#3B82F6',
        gradient: ['#3B82F6', '#1D4ED8'],
      };
    case 'en_cours':
      return {
        label: 'En cours',
        color: '#F59E0B',
        gradient: ['#F59E0B', '#D97706'],
      };
    case 'terminee':
      return {
        label: 'Terminée',
        color: '#10B981',
        gradient: ['#10B981', '#059669'],
      };
    case 'rejetee_replanifiee':
      return {
        label: 'Rejetée - Replanifiée',
        color: '#EF4444',
        gradient: ['#EF4444', '#DC2626'],
      };
    default:
      return {
        label: 'Planifiée',
        color: '#64748B',
        gradient: ['#64748B', '#475569'],
      };
  }
};

export const getReportStatusInfo = (status: string) => {
  switch (status) {
    case 'brouillon':
      return {
        label: 'Brouillon',
        color: '#64748B',
        gradient: ['#64748B', '#475569'],
      };
    case 'envoye':
      return {
        label: 'Envoyé',
        color: '#3B82F6',
        gradient: ['#3B82F6', '#1D4ED8'],
      };
    case 'valide':
      return {
        label: 'Validé',
        color: '#10B981',
        gradient: ['#10B981', '#059669'],
      };
    case 'rejete':
      return {
        label: 'Rejeté',
        color: '#EF4444',
        gradient: ['#EF4444', '#DC2626'],
      };
    case 'archive':
      return {
        label: 'Archivé',
        color: '#64748B',
        gradient: ['#64748B', '#475569'],
      };
    default:
      return {
        label: 'Brouillon',
        color: '#64748B',
        gradient: ['#64748B', '#475569'],
      };
  }
};

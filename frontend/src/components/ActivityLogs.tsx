import { useState, useEffect } from 'react';
import { activityLogsAPI, usersAPI } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Activity, Search, Calendar, User, Filter } from 'lucide-react';

interface ActivityLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
}

interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
}

export default function ActivityLogs() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState < ActivityLog[] > ([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState < string > ('all');
  const [userProfiles, setUserProfiles] = useState < Record < string, UserProfile>> ({});

  const isAdmin = profile?.role === 'ROLE_ADMIN';

  useEffect(() => {
    if (isAdmin) {
      fetchLogs();
      fetchUserProfiles();
    }
  }, [isAdmin]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await activityLogsAPI.getAll();
      setLogs(data);
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
    setLoading(false);
  };

  const fetchUserProfiles = async () => {
    try {
      const data = await usersAPI.getAll();
      const profileMap: Record<string, UserProfile> = {};
      data.forEach((user: any) => {
        profileMap[user.id] = {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
        };
      });
      setUserProfiles(profileMap);
    } catch (error) {
      console.error('Error fetching user profiles:', error);
    }
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      login: 'Connexion',
      logout: 'Déconnexion',
      create_user: 'Création utilisateur',
      update_user: 'Modification utilisateur',
      deactivate_user: 'Désactivation utilisateur',
      activate_user: 'Activation utilisateur',
      create_mission: 'Création mission',
      update_mission_status: 'Modification statut mission',
      assign_mission: 'Attribution mission',
      import_missions_csv: 'Import CSV missions',
      create_report: 'Création rapport',
      edit_report: 'Modification rapport',
      validate_report: 'Validation rapport',
      send_report_to_client: 'Envoi rapport au client',
    };
    return labels[action] || action;
  };

  const getActionColor = (action: string) => {
    if (action.includes('login')) return 'bg-blue-100 text-blue-700 border-blue-200';
    if (action.includes('logout')) return 'bg-slate-100 text-slate-700 border-slate-200';
    if (action.includes('create')) return 'bg-green-100 text-green-700 border-green-200';
    if (action.includes('update') || action.includes('edit')) return 'bg-amber-100 text-amber-700 border-amber-200';
    if (action.includes('delete') || action.includes('deactivate')) return 'bg-red-100 text-red-700 border-red-200';
    if (action.includes('validate') || action.includes('send')) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const uniqueActions = Array.from(new Set(logs.map(log => log.action)));

  const filteredLogs = logs.filter(log => {
    const userName = log.user_id && userProfiles[log.user_id]
      ? `${userProfiles[log.user_id].firstName} ${userProfiles[log.user_id].lastName}`
      : 'Système';

    const matchesSearch =
      userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      getActionLabel(log.action).toLowerCase().includes(searchTerm.toLowerCase()) ||
      JSON.stringify(log.details || {}).toLowerCase().includes(searchTerm.toLowerCase());

    const matchesAction = actionFilter === 'all' || log.action === actionFilter;

    return matchesSearch && matchesAction;
  });

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600">Accès réservé aux Super Admins</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-12">Chargement...</div>;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Logs d'activité</h1>
        <p className="text-slate-600 mt-1">Historique complet des actions utilisateurs</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Rechercher par utilisateur, action, détails..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="pl-10 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-prosps-blue focus:border-transparent outline-none appearance-none bg-white"
            >
              <option value="all">Toutes les actions</option>
              {uniqueActions.map(action => (
                <option key={action} value={action}>{getActionLabel(action)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Date & Heure</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Utilisateur</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Action</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-slate-900">Détails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredLogs.map((log) => {
                const userProfile = log.user_id ? userProfiles[log.user_id] : null;
                const userName = userProfile
                  ? `${userProfile.firstName} ${userProfile.lastName}`
                  : 'Système';

                return (
                  <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-slate-700">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <div>
                          <div>{new Date(log.created_at).toLocaleDateString('fr-FR')}</div>
                          <div className="text-xs text-slate-500">
                            {new Date(log.created_at).toLocaleTimeString('fr-FR')}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-900">{userName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getActionColor(log.action)}`}>
                        {getActionLabel(log.action)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {log.details ? (
                        <div className="text-sm text-slate-600">
                          {Object.entries(log.details).map(([key, value]) => (
                            <div key={key}>
                              <span className="font-medium">{key}:</span> {String(value)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredLogs.length === 0 && (
            <div className="text-center py-12">
              <Activity className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600">Aucun log trouvé</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600">
        <p><strong>Note:</strong> Les logs sont conservés pendant 5 ans minimum conformément aux exigences RGPD et réglementaires.</p>
      </div>
    </div>
  );
}

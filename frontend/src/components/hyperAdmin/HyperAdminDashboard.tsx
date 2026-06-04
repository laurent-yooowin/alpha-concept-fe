import { useEffect, useState } from 'react';
import { hyperAdminAPI } from '../../lib/api';
import { Building2, Users, Briefcase, Camera, FileText, UserCircle, Loader2 } from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

interface OrgRow {
  organization: { id: string; name: string; slug: string; isActive: boolean };
  admins: number;
  coordinators: number;
  missions: number;
  visits: number;
  reports: number;
  clients: number;
  missionStatuses?: Record<string, number>;
  reportStatuses?: Record<string, number>;
}

interface Dashboard {
  totals: {
    organizations: number;
    users: number;
    missions: number;
    visits: number;
    reports: number;
    clients: number;
  };
  perOrganization: OrgRow[];
}

const Stat = ({ icon: Icon, label, value, color }: any) => (
  <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 flex items-center gap-4">
    <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${color}`}>
      <Icon className="w-6 h-6 text-white" />
    </div>
    <div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  </div>
);

const MISSION_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  planifiee: { label: 'Planifiée', color: 'bg-blue-100 text-blue-700' },
  assignee: { label: 'Assignée', color: 'bg-indigo-100 text-indigo-700' },
  en_cours: { label: 'En cours', color: 'bg-amber-100 text-amber-700' },
  terminee: { label: 'Terminée', color: 'bg-emerald-100 text-emerald-700' },
  validee: { label: 'Validée', color: 'bg-green-100 text-green-700' },
  archivee: { label: 'Archivée', color: 'bg-slate-200 text-slate-600' },
};

const REPORT_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  brouillon: { label: 'Brouillon', color: 'bg-slate-100 text-slate-700' },
  envoye: { label: 'Envoyé', color: 'bg-blue-100 text-blue-700' },
  valide: { label: 'Validé', color: 'bg-emerald-100 text-emerald-700' },
  refuse: { label: 'Refusé', color: 'bg-rose-100 text-rose-700' },
  archive: { label: 'Archivé', color: 'bg-slate-200 text-slate-600' },
  envoye_au_client: { label: 'Envoyé client', color: 'bg-violet-100 text-violet-700' },
  annule: { label: 'Annulé', color: 'bg-rose-100 text-rose-700' },
};

const StatusBreakdown = ({
  counts,
  labels,
}: {
  counts?: Record<string, number>;
  labels: Record<string, { label: string; color: string }>;
}) => {
  const entries = Object.entries(counts || {}).filter(([, v]) => v > 0);
  if (entries.length === 0) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => {
        const meta = labels[k] || { label: k, color: 'bg-slate-100 text-slate-700' };
        return (
          <span key={k} className={`text-[10px] px-2 py-0.5 rounded-full ${meta.color}`}>
            {meta.label}: <strong>{v}</strong>
          </span>
        );
      })}
    </div>
  );
};

export default function HyperAdminDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    hyperAdminAPI
      .dashboard()
      .then(setData)
      .catch((e) => setError(e.message || 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Chargement...</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!data) return null;

  // Aggregate data for charts
  const missionStatusTotals: Record<string, number> = {};
  const reportStatusTotals: Record<string, number> = {};
  for (const row of data.perOrganization) {
    for (const [k, v] of Object.entries(row.missionStatuses || {})) {
      missionStatusTotals[k] = (missionStatusTotals[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(row.reportStatuses || {})) {
      reportStatusTotals[k] = (reportStatusTotals[k] || 0) + v;
    }
  }

  const PIE_COLORS = ['#3b82f6', '#6366f1', '#f59e0b', '#10b981', '#22c55e', '#94a3b8', '#a855f7', '#ef4444'];

  const missionPieData = Object.entries(missionStatusTotals).map(([k, v]) => ({
    name: MISSION_STATUS_LABELS[k]?.label || k, value: v,
  }));
  const reportPieData = Object.entries(reportStatusTotals).map(([k, v]) => ({
    name: REPORT_STATUS_LABELS[k]?.label || k, value: v,
  }));

  const perOrgBarData = data.perOrganization.map((r) => ({
    name: r.organization.name.length > 14 ? r.organization.name.slice(0, 14) + '…' : r.organization.name,
    Chantiers: r.missions,
    Visites: r.visits,
    Rapports: r.reports,
    Clients: r.clients,
  }));

  const activeOrgs = data.perOrganization.filter((r) => r.organization.isActive).length;
  const orgStatusPie = [
    { name: 'Actives', value: activeOrgs },
    { name: 'Inactives', value: data.totals.organizations - activeOrgs },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Vue globale</h1>
        <p className="text-slate-500 mt-1">Métriques agrégées sur toutes les organisations.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <Stat icon={Building2} label="Organisations" value={data.totals.organizations} color="bg-amber-500" />
        <Stat icon={Users} label="Utilisateurs" value={data.totals.users} color="bg-blue-500" />
        <Stat icon={Briefcase} label="Chantiers" value={data.totals.missions} color="bg-emerald-500" />
        <Stat icon={Camera} label="Visites" value={data.totals.visits} color="bg-violet-500" />
        <Stat icon={FileText} label="Rapports" value={data.totals.reports} color="bg-rose-500" />
        <Stat icon={UserCircle} label="Clients" value={data.totals.clients} color="bg-slate-700" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Chantiers par statut</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={missionPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {missionPieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Rapports par statut</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={reportPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={80} label>
                  {reportPieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="font-semibold text-slate-900 mb-3">Organisations actives / inactives</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={orgStatusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  <Cell fill="#10b981" />
                  <Cell fill="#94a3b8" />
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
        <h3 className="font-semibold text-slate-900 mb-3">Volumes par organisation</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={perOrgBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Chantiers" fill="#10b981" />
              <Bar dataKey="Visites" fill="#8b5cf6" />
              <Bar dataKey="Rapports" fill="#f43f5e" />
              <Bar dataKey="Clients" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-900">Détails par organisation</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-6 py-3 text-left">Organisation</th>
                <th className="px-4 py-3 text-right">Admins</th>
                <th className="px-4 py-3 text-right">Coord.</th>
                <th className="px-4 py-3 text-right">Clients</th>
                <th className="px-4 py-3 text-right">Visites</th>
                <th className="px-4 py-3 text-left">Chantiers (par statut)</th>
                <th className="px-4 py-3 text-left">Rapports (par statut)</th>
                <th className="px-4 py-3 text-center">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.perOrganization.map((row) => (
                <tr key={row.organization.id} className="hover:bg-slate-50">
                  <td className="px-6 py-3">
                    <div className="font-medium text-slate-900">{row.organization.name}</div>
                    <div className="text-xs text-slate-400">/login/{row.organization.slug}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{row.admins}</td>
                  <td className="px-4 py-3 text-right">{row.coordinators}</td>
                  <td className="px-4 py-3 text-right">{row.clients}</td>
                  <td className="px-4 py-3 text-right">{row.visits}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-500 mb-1">Total: <strong className="text-slate-900">{row.missions}</strong></div>
                    <StatusBreakdown counts={row.missionStatuses} labels={MISSION_STATUS_LABELS} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-500 mb-1">Total: <strong className="text-slate-900">{row.reports}</strong></div>
                    <StatusBreakdown counts={row.reportStatuses} labels={REPORT_STATUS_LABELS} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-1 rounded-full ${row.organization.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                      {row.organization.isActive ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                </tr>
              ))}
              {data.perOrganization.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-slate-400">Aucune organisation</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

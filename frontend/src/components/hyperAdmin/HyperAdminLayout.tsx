import { useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LayoutDashboard, Building2, LogOut, Users, FileText, Shield } from 'lucide-react';

export default function HyperAdminLayout() {
  const { user, profile, organization, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading) {
      if (!user) navigate('/login');
      else if (user.role !== 'ROLE_HYPER_ADMIN') {
        navigate(organization?.slug ? `/${organization.slug}/dashboard` : '/login');
      }
    }
  }, [user, organization, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Chargement...
      </div>
    );
  }

  const nav = [
    { path: '/hyper-admin', name: 'Tableau de bord', icon: LayoutDashboard, exact: true },
    { path: '/hyper-admin/organizations', name: 'Organisations', icon: Building2 },
    { path: '/hyper-admin/users', name: 'Utilisateurs', icon: Users },
    { path: '/hyper-admin/cgu', name: 'CGU', icon: FileText },
    { path: '/hyper-admin/privacy', name: 'Confidentialité', icon: Shield },
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="fixed top-0 left-0 h-full w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6 border-b border-white/10 flex flex-col items-center gap-2">
          <img
            src="/logo_admin.png"
            alt="Report BTP"
            className="h-20 w-auto rounded-lg bg-white p-1 object-contain"
          />
          <div className="text-center">
            <p className="font-bold leading-tight">Hyper Admin</p>
            <p className="text-xs text-white/60">Supervision globale</p>
          </div>
        </div>
        <nav className="p-4 space-y-1 flex-1" style={{ maxHeight: 'calc(100vh - 200px - 120px)' }}>
          {nav.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${isActive ? 'bg-amber-400 text-slate-900 font-semibold' : 'text-white/80 hover:bg-white/10'
                  }`}
              >
                <Icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/10 space-y-3">
          {profile && (
            <div className="px-3 py-2 bg-white/5 rounded-lg">
              <p className="text-sm font-medium">{profile.firstName} {profile.lastName}</p>
              <p className="text-xs text-white/60">{profile.email}</p>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-white/80 hover:bg-white/10 text-sm"
          >
            <LogOut className="w-4 h-4" />
            Déconnexion
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto" style={{ marginLeft: '16rem' }}>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

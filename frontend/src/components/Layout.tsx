import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  Menu,
  X,
  Send,
  Activity,
  LogOut,
} from 'lucide-react';

export default function Layout() {
  const { user, profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  const isAdmin = profile?.role === 'ROLE_ADMIN';

  const navigation = [
    { path: '/dashboard', name: 'Tableau de bord', icon: LayoutDashboard, show: true },
    { path: '/missions', name: 'Missions', icon: Briefcase, show: true },
    { path: '/dispatch', name: 'Attribution', icon: Send, show: isAdmin },
    { path: '/reports', name: 'Rapports', icon: FileText, show: true },
    { path: '/users', name: 'Utilisateurs', icon: Users, show: isAdmin },
    { path: '/logs', name: 'Logs d\'activité', icon: Activity, show: false },
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen relative">
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: 'url(https://images.pexels.com/photos/159306/construction-site-build-construction-work-159306.jpeg?auto=compress&cs=tinysrgb&w=1920)',
        }}
      >
        <div className="absolute inset-0 bg-white/90 backdrop-blur-sm"></div>
      </div>

      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <img src="/icon.jpg" alt="Report BTP" className="h-8" />
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-prosps-blue backdrop-blur-md border-r border-prosps-blue-dark transform transition-transform duration-300 z-40 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } lg:translate-x-0`}
      >
        <div className="p-6 border-b border-white/20">
          <img src="/ChatGPT Image 20 oct. 2025, 19_08_46.png" alt="Report BTP" className="h-20 mb-2" />
          <p className="text-sm text-white/90 mt-1">Plateforme de gestion SPS</p>
        </div>

        <nav className="p-4 space-y-1">
          {navigation.filter(item => item.show).map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                  ? 'bg-white text-prosps-blue'
                  : 'text-white hover:bg-white/10'
                  }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/20 space-y-3">
          {profile && (
            <div className="px-4 py-3 bg-white/10 rounded-lg">
              <p className="text-sm font-medium text-white">
                {profile.firstName} {profile.lastName}
              </p>
              <p className="text-xs text-white/70 mt-1">
                {profile.role === 'ROLE_ADMIN' ? 'Administrateur' : 'Coordonnateur'}
              </p>
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-white hover:bg-white/10 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Déconnexion</span>
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="lg:ml-64 min-h-screen pt-16 lg:pt-0 relative z-10">
        <div className="p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

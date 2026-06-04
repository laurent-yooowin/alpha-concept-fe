import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import Dashboard from '../components/Dashboard';
import UserManagement from '../components/UserManagement';
import MissionManagement from '../components/MissionManagement';
import MissionDispatch from '../components/MissionDispatch';
import ReportManagement from '../components/ReportManagement';
import VisitManagement from '../components/VisitManagement';
import ActivityLogs from '../components/ActivityLogs';
import MailingListManagement from '../components/MailingListManagement';
import LoginPage from '../components/LoginPage';
import OrgLoginPage from '../components/OrgLoginPage';
import HyperAdminLayout from '../components/hyperAdmin/HyperAdminLayout';
import HyperAdminDashboard from '../components/hyperAdmin/HyperAdminDashboard';
import HyperAdminOrganizations from '../components/hyperAdmin/HyperAdminOrganizations';
import HyperAdminUsers from '../components/hyperAdmin/HyperAdminUsers';
import Privacy from '../components/privacy';
import Cgu from '../components/cgu';

function LegacyOrgLoginRedirect() {
  const { slug = '' } = useParams();
  return <Navigate to={`/${slug}/login`} replace />;
}

function HomeRedirect() {
  let target = '/login';
  try {
    const slug = localStorage.getItem('lastOrgSlug')?.trim();
    if (slug) target = `/${slug}/login`;
  } catch {}

  return <Navigate to={target} replace />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/privacy', element: <Privacy /> },
  { path: '/cgu', element: <Cgu /> },
  // Backwards compat redirect: /login/:slug -> /:slug/login
  { path: '/login/:slug', element: <LegacyOrgLoginRedirect /> },
  {
    path: '/hyper-admin',
    element: <HyperAdminLayout />,
    children: [
      { index: true, element: <HyperAdminDashboard /> },
      { path: 'organizations', element: <HyperAdminOrganizations /> },
      { path: 'users', element: <HyperAdminUsers /> },
      { path: 'cgu', element: <Cgu /> },
      { path: 'privacy', element: <Privacy /> },
    ],
  },
  // Org-scoped routes: /:slug/...
  { path: '/:slug/login', element: <OrgLoginPage /> },
  {
    path: '/:slug',
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'users', element: <UserManagement /> },
      { path: 'missions', element: <MissionManagement /> },
      { path: 'dispatch', element: <MissionDispatch /> },
      { path: 'visits', element: <VisitManagement /> },
      { path: 'reports', element: <ReportManagement /> },
      { path: 'mailing-list', element: <MailingListManagement /> },
      { path: 'logs', element: <ActivityLogs /> },
      { path: 'privacy-policy', element: <Privacy /> },
      { path: 'cgu-terms', element: <Cgu /> },
    ],
  },
  { path: '/', element: <HomeRedirect /> },
]);

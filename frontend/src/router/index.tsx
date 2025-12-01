import { createBrowserRouter, Navigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Dashboard from '../components/Dashboard';
import UserManagement from '../components/UserManagement';
import MissionManagement from '../components/MissionManagement';
import MissionDispatch from '../components/MissionDispatch';
import ReportManagement from '../components/ReportManagement';
import ActivityLogs from '../components/ActivityLogs';
import LoginPage from '../components/LoginPage';
import LegalDocs from '../components/cgu';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <Dashboard />,
      },
      {
        path: 'users',
        element: <UserManagement />,
      },
      {
        path: 'missions',
        element: <MissionManagement />,
      },
      {
        path: 'dispatch',
        element: <MissionDispatch />,
      },
      {
        path: 'reports',
        element: <ReportManagement />,
      },
      {
        path: 'logs',
        element: <ActivityLogs />,
      },
      {
        path: 'privacy',
        element: <LegalDocs isCgu={false} />,
      },
      {
        path: 'cgu',
        element: <LegalDocs isCgu={true} />,
      },
    ],
  },
]);

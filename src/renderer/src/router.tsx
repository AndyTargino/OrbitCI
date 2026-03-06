import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Login } from '@/pages/Login'
import { Workspace } from '@/pages/Workspace'
import { Dashboard } from '@/pages/Dashboard'
import { Settings } from '@/pages/Settings'

export const router = createHashRouter([
  { path: '/login', element: <Login /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Workspace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'settings', element: <Settings /> },
      { path: 'repos', element: <Navigate to="/" replace /> },
      { path: 'repo/*', element: <Navigate to="/" replace /> },
      { path: 'run/*', element: <Navigate to="/" replace /> },
      { path: 'history', element: <Navigate to="/" replace /> },
      { path: 'analytics', element: <Navigate to="/dashboard" replace /> },
      { path: 'secrets', element: <Navigate to="/settings" replace /> }
    ]
  }
])

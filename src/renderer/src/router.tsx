import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Login } from '@/pages/Login'
import { Repos } from '@/pages/Repos'
import { Dashboard } from '@/pages/Dashboard'
import { History } from '@/pages/History'
import { Editor } from '@/pages/Editor'
import { Settings } from '@/pages/Settings'
import { Secrets } from '@/pages/Secrets'
import { Analytics } from '@/pages/Analytics'

export const router = createHashRouter([
  {
    path: '/login',
    element: <Login />
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/repos" replace /> },
      { path: 'repos', element: <Repos /> },
      { path: 'dashboard/:repoId', element: <Dashboard /> },
      { path: 'run/:runId', element: <Navigate to="/history" replace /> },
      { path: 'editor/:repoId/:file?', element: <Editor /> },
      { path: 'history', element: <History /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'secrets', element: <Secrets /> },
      { path: 'settings', element: <Settings /> }
    ]
  }
])

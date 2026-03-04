import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Login } from '@/pages/Login'
import { Home } from '@/pages/Home'
import { Repos } from '@/pages/Repos'
import { RepoDetail } from '@/pages/repo/RepoDetail'
import { RepoOverview } from '@/pages/repo/RepoOverview'
import { RepoChanges } from '@/pages/repo/RepoChanges'
import { RepoPipelines } from '@/pages/repo/RepoPipelines'
import { RepoHistory } from '@/pages/repo/RepoHistory'
import { RepoActions } from '@/pages/repo/RepoActions'
import { RunDetail } from '@/pages/RunDetail'
import { History } from '@/pages/History'
import { Editor } from '@/pages/Editor'
import { Settings } from '@/pages/Settings'

export const router = createHashRouter([
  {
    path: '/login',
    element: <Login />
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      { path: 'repos', element: <Repos /> },
      {
        path: 'repo/:repoId',
        element: <RepoDetail />,
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: 'overview', element: <RepoOverview /> },
          { path: 'changes', element: <RepoChanges /> },
          { path: 'workflows', element: <RepoPipelines /> },
          { path: 'runs', element: <RepoActions /> },
          { path: 'history', element: <RepoHistory /> },
          // Legacy redirects
          { path: 'pipelines', element: <Navigate to="../workflows" replace /> },
          { path: 'actions', element: <Navigate to="../runs" replace /> }
        ]
      },
      { path: 'run/:runId', element: <RunDetail /> },
      { path: 'editor/:repoId/:file?', element: <Editor /> },
      { path: 'history', element: <History /> },
      { path: 'settings', element: <Settings /> },
      // Legacy redirects
      { path: 'dashboard/:repoId', element: <Navigate to="/repos" replace /> },
      { path: 'analytics', element: <Navigate to="/" replace /> },
      { path: 'secrets', element: <Navigate to="/settings" replace /> }
    ]
  }
])

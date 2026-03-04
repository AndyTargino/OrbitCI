import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function App(): JSX.Element {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  )
}

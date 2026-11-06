import { createHashRouter, RouterProvider } from 'react-router-dom'
import { Shell } from './components/Shell'
import { DashboardPage } from './pages/Dashboard'
import { TransactionsPage } from './pages/Transactions'
import { CategoriesPage } from './pages/Categories'
import { RecurringPage } from './pages/Recurring'
import { IncomePage } from './pages/Income'
import { InvestmentsPage } from './pages/Investments'
import { NetWorthPage } from './pages/NetWorth'
import { GrowthPage } from './pages/Growth'
import { DataPage } from './pages/Data'
import { AuthGate } from './data/auth'

const router = createHashRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'transacoes', element: <TransactionsPage /> },
      { path: 'categorias', element: <CategoriesPage /> },
      { path: 'fixas', element: <RecurringPage /> },
      { path: 'rendas', element: <IncomePage /> },
      { path: 'investimentos', element: <InvestmentsPage /> },
      { path: 'patrimonio', element: <NetWorthPage /> },
      { path: 'crescimento', element: <GrowthPage /> },
      { path: 'dados', element: <DataPage /> },
    ],
  },
])

export default function App() {
  return (
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  )
}

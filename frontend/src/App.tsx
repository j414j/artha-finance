import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './layout/AppShell'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AccountsPage from './pages/AccountsPage'
import TransactionsPage from './pages/TransactionsPage'
import BudgetPage from './pages/BudgetPage'
import InvestmentsPage from './pages/InvestmentsPage'
import FxRatesPage from './pages/FxRatesPage'
import GoalsPage from './pages/GoalsPage'
import ReportsPage from './pages/ReportsPage'
import CashFlowReport from './pages/reports/CashFlowReport'
import NetWorthReport from './pages/reports/NetWorthReport'
import SpendingReport from './pages/reports/SpendingReport'
import BudgetReport from './pages/reports/BudgetReport'
import InvestmentsReport from './pages/reports/InvestmentsReport'
import GoalsReport from './pages/reports/GoalsReport'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="budget" element={<BudgetPage />} />
            <Route path="investments" element={<InvestmentsPage />} />
            <Route path="fx-rates" element={<FxRatesPage />} />
            <Route path="goals" element={<GoalsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="reports/cashflow" element={<CashFlowReport />} />
            <Route path="reports/net-worth" element={<NetWorthReport />} />
            <Route path="reports/spending" element={<SpendingReport />} />
            <Route path="reports/budget" element={<BudgetReport />} />
            <Route path="reports/investments" element={<InvestmentsReport />} />
            <Route path="reports/goals" element={<GoalsReport />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

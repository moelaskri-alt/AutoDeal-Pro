import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import './styles/app.css';
import { AuthProvider, useAuth } from './lib/auth';
import { UiProvider } from './lib/ui';
import { Layout, NAV, allowed } from './components/Layout';
import { Spinner } from './components/common';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { VehiclesPage, VehicleDetailPage } from './pages/Vehicles';
import { PurchasesPage } from './pages/Purchases';
import { CostsPage } from './pages/Costs';
import { CustomersPage, CustomerDetailPage } from './pages/Customers';
import { LeadsPage } from './pages/Leads';
import { QuotationsPage } from './pages/Quotations';
import { ReservationsPage } from './pages/Reservations';
import { SalesPage, SaleDetailPage, NewSalePage } from './pages/Sales';
import { InstallmentsPage, ContractDetailPage } from './pages/Installments';
import { TradeInsPage } from './pages/TradeIns';
import { ExpensesPage } from './pages/Expenses';
import { ReportsPage } from './pages/Reports';
import { UsersPage } from './pages/Users';
import { SettingsPage } from './pages/Settings';
import { BackupPage } from './pages/Backup';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error)
      return (
        <div className="empty">
          <h3>حدث خطأ غير متوقع في عرض هذه الشاشة</h3>
          <p>لم تتأثر بياناتك. يرجى إعادة تحميل الشاشة.</p>
          <button className="btn primary" onClick={() => location.reload()}>
            إعادة التحميل
          </button>
        </div>
      );
    return this.props.children;
  }
}

function Guard({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!allowed(can, perm))
    return (
      <div className="empty">
        <h3>لا تملك صلاحية الوصول لهذه الشاشة</h3>
        <p>يرجى التواصل مع مدير النظام إذا كنت تحتاج هذه الصلاحية.</p>
      </div>
    );
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <DashboardPage />;
  const first = NAV.find((n) => allowed(can, n.perm));
  return first ? <Navigate to={first.to} replace /> : <div className="empty">لا توجد صلاحيات لهذا المستخدم.</div>;
}

function Shell() {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <LoginPage />;
  const g = (perm: string, el: React.ReactNode) => <Guard perm={perm}>{el}</Guard>;
  return (
    <Layout>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/vehicles" element={g('vehicles.view', <VehiclesPage />)} />
          <Route path="/vehicles/:id" element={g('vehicles.view', <VehicleDetailPage />)} />
          <Route path="/purchases" element={g('purchases.view', <PurchasesPage />)} />
          <Route path="/costs" element={g('costs.view', <CostsPage />)} />
          <Route path="/customers" element={g('customers.view', <CustomersPage />)} />
          <Route path="/customers/:id" element={g('customers.view', <CustomerDetailPage />)} />
          <Route path="/leads" element={g('leads.view', <LeadsPage />)} />
          <Route path="/quotations" element={g('quotations.view', <QuotationsPage />)} />
          <Route path="/reservations" element={g('reservations.view', <ReservationsPage />)} />
          <Route path="/sales" element={g('sales.view', <SalesPage />)} />
          <Route path="/sales/new" element={g('sales.create', <NewSalePage />)} />
          <Route path="/sales/:id" element={g('sales.view', <SaleDetailPage />)} />
          <Route path="/installments" element={g('installments.view', <InstallmentsPage />)} />
          <Route path="/installments/:id" element={g('installments.view', <ContractDetailPage />)} />
          <Route path="/tradeins" element={g('tradeins.view', <TradeInsPage />)} />
          <Route path="/expenses" element={g('expenses.view', <ExpensesPage />)} />
          <Route path="/reports" element={g('reports.view', <ReportsPage />)} />
          <Route path="/users" element={g('users.manage|audit.view', <UsersPage />)} />
          <Route path="/settings" element={g('settings.manage', <SettingsPage />)} />
          <Route path="/backup" element={g('backup.manage', <BackupPage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <UiProvider>
      <AuthProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </AuthProvider>
    </UiProvider>
  </React.StrictMode>,
);

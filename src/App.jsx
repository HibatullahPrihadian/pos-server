import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { BusinessProvider } from './context/BusinessContext';
import { SettingsProvider } from './context/SettingsContext';
import CartProvider from './context/CartContext';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';

// Login eager (paint pertama). Halaman lain di-code-split per route.
import Login from './pages/Login';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const POS = lazy(() => import('./pages/POS'));
const Transactions = lazy(() => import('./pages/Transactions'));
const Products = lazy(() => import('./pages/Products'));
const Promotions = lazy(() => import('./pages/Promotions'));
const Bundles = lazy(() => import('./pages/Bundles'));
const Consignment = lazy(() => import('./pages/Consignment'));
const Attendance = lazy(() => import('./pages/Attendance'));
const Categories = lazy(() => import('./pages/Categories'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Stock = lazy(() => import('./pages/Stock'));
const StockOpname = lazy(() => import('./pages/StockOpname'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Members = lazy(() => import('./pages/Members'));
const Customers = lazy(() => import('./pages/Customers'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Shifts = lazy(() => import('./pages/Shifts'));
const Reports = lazy(() => import('./pages/Reports'));
const Users = lazy(() => import('./pages/Users'));
const Settings = lazy(() => import('./pages/Settings'));
const PrintServices = lazy(() => import('./pages/PrintServices'));
const PrintOrders = lazy(() => import('./pages/PrintOrders'));
const PrintOrderForm = lazy(() => import('./pages/PrintOrderForm'));
const PrintReports = lazy(() => import('./pages/PrintReports'));
const OwnerDashboard = lazy(() => import('./pages/OwnerDashboard'));

// Halaman di dalam layout (butuh login). `permission` diproteksi di dua lapis:
// route guard di sini dan penyembunyian menu di Sidebar.
const Page = ({ children, permission }) => (
  <ProtectedRoute permission={permission}>
    <MainLayout>
      <Suspense fallback={<div className="p-6 text-sm opacity-60">Memuat…</div>}>{children}</Suspense>
    </MainLayout>
  </ProtectedRoute>
);

function App() {
  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          <BusinessProvider>
            <SettingsProvider>
              <CartProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />

                  <Route path="/" element={<Page permission="report.view"><Dashboard /></Page>} />
                  {/* Owner: ringkasan gabungan lintas usaha (header X-Business: all). */}
                  <Route path="/overview" element={<Page permission="report.view"><OwnerDashboard /></Page>} />
                  <Route path="/pos" element={<Page permission="pos.use"><POS /></Page>} />
                  <Route path="/transactions" element={<Page permission="pos.use"><Transactions /></Page>} />
                  <Route path="/shifts" element={<Page permission="shift.use"><Shifts /></Page>} />

                  <Route path="/products" element={<Page permission="product.view"><Products /></Page>} />
                  <Route path="/promotions" element={<Page permission="promotion.manage"><Promotions /></Page>} />
                  <Route path="/bundles" element={<Page permission="bundle.manage"><Bundles /></Page>} />
                  <Route path="/consignment" element={<Page permission="consignment.manage"><Consignment /></Page>} />
                  <Route path="/categories" element={<Page permission="product.view"><Categories /></Page>} />
                  <Route path="/suppliers" element={<Page permission="product.view"><Suppliers /></Page>} />
                  <Route path="/stock" element={<Page permission="stock.view"><Stock /></Page>} />
                  <Route path="/stock-opname" element={<Page permission="stock.view"><StockOpname /></Page>} />
                  <Route path="/purchases" element={<Page permission="purchase.view"><Purchases /></Page>} />
                  <Route path="/expenses" element={<Page permission="expense.manage"><Expenses /></Page>} />

                  <Route path="/members" element={<Page permission="member.manage"><Members /></Page>} />
                  <Route path="/customers" element={<Page permission="customer.manage"><Customers /></Page>} />
                  <Route path="/invoices" element={<Page permission="invoice.view"><Invoices /></Page>} />
                  <Route path="/reports" element={<Page permission="report.view"><Reports /></Page>} />

                  <Route path="/attendance" element={<Page permission="attendance.self"><Attendance /></Page>} />

                  {/* Modul fotokopi (mode usaha fotokopi) */}
                  <Route path="/print-services" element={<Page permission="print.manage"><PrintServices /></Page>} />
                  <Route path="/print-orders" element={<Page permission="print.use"><PrintOrders /></Page>} />
                  <Route path="/print-orders/new" element={<Page permission="print.use"><PrintOrderForm /></Page>} />
                  <Route path="/print-orders/:id/edit" element={<Page permission="print.use"><PrintOrderForm /></Page>} />
                  <Route path="/print-reports" element={<Page permission="print.report"><PrintReports /></Page>} />

                  <Route path="/users" element={<Page permission="user.manage"><Users /></Page>} />
                  <Route path="/settings" element={<Page permission="settings.manage"><Settings /></Page>} />

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </CartProvider>
            </SettingsProvider>
          </BusinessProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;

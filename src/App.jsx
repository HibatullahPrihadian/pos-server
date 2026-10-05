import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { SettingsProvider } from './context/SettingsContext';
import CartProvider from './context/CartContext';
import ProtectedRoute from './components/ProtectedRoute';
import MainLayout from './components/layout/MainLayout';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Transactions from './pages/Transactions';
import Products from './pages/Products';
import Promotions from './pages/Promotions';
import Bundles from './pages/Bundles';
import Consignment from './pages/Consignment';
import Attendance from './pages/Attendance';
import Categories from './pages/Categories';
import Suppliers from './pages/Suppliers';
import Stock from './pages/Stock';
import StockOpname from './pages/StockOpname';
import Purchases from './pages/Purchases';
import Expenses from './pages/Expenses';
import Members from './pages/Members';
import Customers from './pages/Customers';
import Invoices from './pages/Invoices';
import Shifts from './pages/Shifts';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Settings from './pages/Settings';

// Halaman di dalam layout (butuh login). `permission` diproteksi di dua lapis:
// route guard di sini dan penyembunyian menu di Sidebar.
const Page = ({ children, permission }) => (
  <ProtectedRoute permission={permission}>
    <MainLayout>{children}</MainLayout>
  </ProtectedRoute>
);

function App() {
  return (
    <Router>
      <AuthProvider>
        <ToastProvider>
          <SettingsProvider>
            <CartProvider>
              <Routes>
                <Route path="/login" element={<Login />} />

                <Route path="/" element={<Page permission="report.view"><Dashboard /></Page>} />
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

                <Route path="/users" element={<Page permission="user.manage"><Users /></Page>} />
                <Route path="/settings" element={<Page permission="settings.manage"><Settings /></Page>} />

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </CartProvider>
          </SettingsProvider>
        </ToastProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;

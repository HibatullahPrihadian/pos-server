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
import Categories from './pages/Categories';
import Suppliers from './pages/Suppliers';
import Stock from './pages/Stock';
import StockOpname from './pages/StockOpname';
import Purchases from './pages/Purchases';
import Members from './pages/Members';
import Shifts from './pages/Shifts';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Settings from './pages/Settings';

// Halaman di dalam layout (butuh login). adminOnly diproteksi di dua lapis:
// route guard di sini dan penyembunyian menu di Sidebar.
const Page = ({ children, adminOnly = false }) => (
  <ProtectedRoute adminOnly={adminOnly}>
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

                <Route path="/" element={<Page adminOnly><Dashboard /></Page>} />
                <Route path="/pos" element={<Page><POS /></Page>} />
                <Route path="/transactions" element={<Page><Transactions /></Page>} />
                <Route path="/shifts" element={<Page><Shifts /></Page>} />

                <Route path="/products" element={<Page adminOnly><Products /></Page>} />
                <Route path="/categories" element={<Page adminOnly><Categories /></Page>} />
                <Route path="/suppliers" element={<Page adminOnly><Suppliers /></Page>} />
                <Route path="/stock" element={<Page adminOnly><Stock /></Page>} />
                <Route path="/stock-opname" element={<Page adminOnly><StockOpname /></Page>} />
                <Route path="/purchases" element={<Page adminOnly><Purchases /></Page>} />

                <Route path="/members" element={<Page><Members /></Page>} />
                <Route path="/reports" element={<Page adminOnly><Reports /></Page>} />

                <Route path="/users" element={<Page adminOnly><Users /></Page>} />
                <Route path="/settings" element={<Page adminOnly><Settings /></Page>} />

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

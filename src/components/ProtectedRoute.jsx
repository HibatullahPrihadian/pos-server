import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from './ui/Spinner';

// Urutan halaman yang aman dikunjungi bila halaman yang diminta tidak diizinkan.
const FALLBACKS = [
  { permission: 'pos.use', path: '/pos' },
  { permission: 'stock.view', path: '/stock' },
  { permission: 'product.view', path: '/products' },
  { permission: 'purchase.view', path: '/purchases' },
  { permission: 'attendance.self', path: '/attendance' },
  { permission: 'report.view', path: '/' },
];

// Proteksi route: butuh login, dan opsional izin tertentu (`permission`).
const ProtectedRoute = ({ children, permission }) => {
  const { user, loading, can, logout } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Memeriksa sesi..." />;

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  if (permission && !can(permission)) {
    const fallback = FALLBACKS.find((f) => can(f.permission));
    if (!fallback) {
      // Akun tanpa izin dasar: jangan redirect (bisa memutar tanpa henti),
      // tampilkan pesan dan tombol keluar.
      return (
        <div className="min-h-screen flex items-center justify-center p-6 text-center">
          <div className="max-w-sm">
            <p className="text-white font-medium mb-2">Akun tidak memiliki akses</p>
            <p className="text-sm text-slate-400 mb-4">
              Hubungi administrator untuk memberikan izin akses, atau keluar dari akun ini.
            </p>
            <button
              type="button"
              onClick={logout}
              className="px-4 py-2 rounded-ios-sm bg-ios-blue text-white text-sm"
            >
              Keluar
            </button>
          </div>
        </div>
      );
    }
    return <Navigate to={fallback.path} replace />;
  }

  return children;
};

export default ProtectedRoute;


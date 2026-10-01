import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from './ui/Spinner';

// Proteksi route: butuh login, dan opsional role admin.
const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Memeriksa sesi..." />;

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  if (adminOnly && !isAdmin) return <Navigate to="/pos" replace />;

  return children;
};

export default ProtectedRoute;

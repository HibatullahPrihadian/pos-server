import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { Store, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const Login = () => {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedIn = await login(username.trim(), password);
      navigate(loggedIn.role === 'admin' ? '/' : '/pos', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900/65 backdrop-blur-glass border border-white/10 rounded-ios shadow-glass p-8 animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-ios bg-ios-blue/15 border border-ios-blue/30 mb-4">
            <Store size={28} className="text-ios-blue" />
          </div>
          <h1 className="text-2xl font-bold text-white">POS Minimarket</h1>
          <p className="text-sm text-slate-400 mt-1">Masuk untuk melanjutkan</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />

          {error && (
            <div className="px-3 py-2 rounded-ios-sm bg-ios-red/15 border border-ios-red/40 text-ios-red text-sm">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={submitting} size="lg">
            <LogIn size={18} />
            {submitting ? 'Memproses...' : 'Masuk'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Login;

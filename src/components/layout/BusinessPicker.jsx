import { useNavigate } from 'react-router-dom';
import { Store, Printer, LogOut, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useBusiness, BUSINESS_META } from '../../context/BusinessContext';
import Button from '../ui/Button';

const ICONS = {
  minimarket: Store,
  fotokopi: Printer,
};

const TONES = {
  minimarket: 'border-ios-blue/40 bg-ios-blue/10 text-ios-blue hover:border-ios-blue/70',
  fotokopi: 'border-ios-purple/40 bg-ios-purple/10 text-ios-purple hover:border-ios-purple/70',
};

// Pemilih mode usaha: tampil setelah login bila user berhak atas lebih dari
// satu usaha (owner/admin). Staf dengan satu usaha melewati layar ini.
const BusinessPicker = () => {
  const { user, logout } = useAuth();
  const { available, setBusiness } = useBusiness();
  const navigate = useNavigate();

  const choose = (key) => {
    setBusiness(key);
    navigate(key === 'fotokopi' ? '/print-orders' : '/', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-lg animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-ios bg-ios-blue/15 border border-ios-blue/30 mb-4">
            <Store size={28} className="text-ios-blue" />
          </div>
          <h1 className="text-2xl font-bold text-white">Pilih Mode Usaha</h1>
          <p className="text-sm text-slate-400 mt-1">
            Masuk sebagai {user?.full_name} · pilih usaha yang dikelola hari ini
          </p>
        </div>

        <div className="space-y-3">
          {available.map((key) => {
            const meta = BUSINESS_META[key] || { label: key, description: '' };
            const Icon = ICONS[key] || Store;
            return (
              <button
                key={key}
                type="button"
                onClick={() => choose(key)}
                className={`w-full flex items-center gap-4 p-5 rounded-ios border backdrop-blur-glass bg-slate-900/65 text-left transition-all ${TONES[key] || TONES.minimarket}`}
              >
                <span className="p-3 rounded-ios-sm bg-white/10 shrink-0">
                  <Icon size={24} />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold text-white">{meta.label}</span>
                  <span className="block text-xs text-slate-400">{meta.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex justify-center mt-8">
          <Button variant="ghost" onClick={() => { logout(); navigate('/login', { replace: true }); }}>
            <LogOut size={16} /> Keluar
          </Button>
        </div>
        <p className="flex items-center justify-center gap-1 text-xs text-slate-400 mt-2">
          <Lock size={10} /> Mode aktif hanya berlaku untuk sesi ini
        </p>
      </div>
    </div>
  );
};

export default BusinessPicker;

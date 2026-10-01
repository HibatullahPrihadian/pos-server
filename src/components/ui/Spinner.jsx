import { Loader2 } from 'lucide-react';

const Spinner = ({ label = 'Memuat...', className = '' }) => (
  <div className={`flex items-center justify-center gap-2 py-10 text-slate-400 ${className}`}>
    <Loader2 size={20} className="animate-spin" />
    <span className="text-sm">{label}</span>
  </div>
);

export default Spinner;

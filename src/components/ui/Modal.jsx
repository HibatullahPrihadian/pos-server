import { X } from 'lucide-react';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

const Modal = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        className={`bg-slate-900/95 backdrop-blur-glass border border-white/10 w-full ${SIZES[size] || SIZES.md} rounded-ios shadow-glass overflow-hidden animate-fade-in max-h-[92vh] flex flex-col`}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            aria-label="Tutup"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-5 border-t border-white/10 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

export default Modal;

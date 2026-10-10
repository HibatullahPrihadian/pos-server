import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
};

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

let uid = 0;

const Modal = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
  const panelRef = useRef(null);
  const titleIdRef = useRef(null);
  if (titleIdRef.current === null) titleIdRef.current = `modal-title-${++uid}`;

  // Esc global per modal agar konsisten (POS mengandalkan cascade; halaman lain
  // sebelumnya tak merespons Esc sama sekali). Stop propagation agar modal
  // bertumpuk menutup satu per satu.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  // Focus-trap + fokus awal: simpan elemen fokus sebelumnya, pindahkan fokus ke
  // dalam dialog, jaga Tab tetap di dalam, lalu pulihkan fokus saat ditutup.
  useEffect(() => {
    if (!isOpen) return undefined;
    const panel = panelRef.current;
    if (!panel) return undefined;
    const previouslyFocused = document.activeElement;

    const focusables = () => Array.from(panel.querySelectorAll(FOCUSABLE))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (!panel.contains(document.activeElement)) {
      const list = focusables();
      (list[0] || panel).focus();
    }

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleIdRef.current : undefined}
        tabIndex={-1}
        className={`bg-slate-900/95 backdrop-blur-glass border border-white/10 w-full ${SIZES[size] || SIZES.md} rounded-ios shadow-glass overflow-hidden animate-fade-in max-h-[92vh] flex flex-col outline-none`}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10 shrink-0">
          <h3 id={titleIdRef.current} className="text-lg font-bold text-white">{title}</h3>
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

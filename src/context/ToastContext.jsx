import { createContext, useContext, useMemo } from 'react';
import useToast from '../hooks/useToast';
import Toast from '../components/ui/Toast';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const toast = useToast();

  // Nilai context sengaja hanya berisi fungsi yang stabil. Bila `toasts`
  // ikut dimasukkan, setiap toast baru akan mengubah identitas context dan
  // memicu ulang useCallback/effect di halaman (berpotensi loop saat error).
  const value = useMemo(
    () => ({
      success: toast.success,
      error: toast.error,
      warning: toast.warning,
      info: toast.info,
    }),
    [toast.success, toast.error, toast.warning, toast.info]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast toasts={toast.toasts} onDismiss={toast.dismiss} />
    </ToastContext.Provider>
  );
};

export const useToastContext = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToastContext harus dipakai di dalam ToastProvider');
  return context;
};

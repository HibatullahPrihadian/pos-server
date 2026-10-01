import { useState, useCallback, useRef, useMemo } from 'react';

// Hook toast sederhana dengan auto-dismiss.
// Objek yang dikembalikan harus stabil antar-render: banyak halaman memakai
// `toast` di dalam useCallback, sehingga identitas yang berubah akan memicu
// ulang effect (dan berpotensi loop fetch saat error).
const useToast = () => {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, type = 'success', duration = 3500) => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => [...prev, { id, message, type }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss]
  );

  const success = useCallback((msg) => push(msg, 'success'), [push]);
  const error = useCallback((msg) => push(msg, 'error', 5000), [push]);
  const warning = useCallback((msg) => push(msg, 'warning', 4500), [push]);
  const info = useCallback((msg) => push(msg, 'info'), [push]);

  return useMemo(
    () => ({ toasts, dismiss, success, error, warning, info }),
    [toasts, dismiss, success, error, warning, info]
  );
};

export default useToast;

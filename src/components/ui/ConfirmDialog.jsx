import { useEffect, useRef } from 'react';
import Modal from './Modal';
import Button from './Button';

const ConfirmDialog = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'Konfirmasi',
  message,
  confirmLabel = 'Ya, Lanjutkan',
  variant = 'danger',
  loading = false,
}) => {
  const confirmRef = useRef(null);

  // Fokus ke tombol konfirmasi saat dialog dibuka agar Enter langsung
  // mengonfirmasi dan Esc global tahu dialog ini yang paling atas.
  useEffect(() => {
    if (isOpen) confirmRef.current?.focus();
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-slate-300 whitespace-pre-line">{message}</p>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="neutral" onClick={onClose} disabled={loading}>
          Batal
        </Button>
        <Button ref={confirmRef} variant={variant} onClick={onConfirm} disabled={loading}>
          {loading ? 'Memproses...' : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;

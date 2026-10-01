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
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
    <p className="text-sm text-slate-300 whitespace-pre-line">{message}</p>
    <div className="flex justify-end gap-2 mt-6">
      <Button variant="neutral" onClick={onClose} disabled={loading}>
        Batal
      </Button>
      <Button variant={variant} onClick={onConfirm} disabled={loading}>
        {loading ? 'Memproses...' : confirmLabel}
      </Button>
    </div>
  </Modal>
);

export default ConfirmDialog;

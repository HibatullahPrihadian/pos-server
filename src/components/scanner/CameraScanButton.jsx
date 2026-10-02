import { Camera } from 'lucide-react';
import Button from '../ui/Button';
import { isCameraAvailable } from '../../hooks/useCameraBarcode';

/**
 * Tombol pemicu pemindai kamera.
 *
 * Bila perangkat/konteks tidak mendukung kamera (mis. diakses via HTTP LAN
 * tanpa HTTPS), tombol dinonaktifkan dengan tooltip penjelas, bukan
 * disembunyikan, supaya kasir tahu fitur ini ada dan mengapa tidak bisa dipakai.
 */
const CameraScanButton = ({ onClick, className = '', label = 'Scan Kamera', ...props }) => {
  const supported = isCameraAvailable();

  return (
    <Button
      variant="neutral"
      onClick={onClick}
      disabled={!supported}
      title={supported ? label : 'Butuh HTTPS untuk kamera'}
      className={className}
      {...props}
    >
      <Camera size={18} />
      {label}
    </Button>
  );
};

export default CameraScanButton;

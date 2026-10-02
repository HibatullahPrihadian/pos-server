import { useEffect } from 'react';
import { Camera, CameraOff, X } from 'lucide-react';
import useCameraBarcode, { CAMERA_ERRORS, isCameraAvailable } from '../../hooks/useCameraBarcode';

/**
 * Modal pemindai barcode memakai kamera perangkat.
 *
 * Komponen ini murni soal kamera + UI; resolusi kode menjadi produk/paket
 * diserahkan ke pemanggil lewat `onDetect`, sehingga jalur yang dipakai sama
 * persis dengan scanner USB (input keyboard).
 */
const BarcodeScannerModal = ({ isOpen, onClose, onDetect, title = 'Scan Barcode', sound = true }) => {
  const { videoRef, devices, deviceId, setDeviceId, error, ready } = useCameraBarcode({
    active: isOpen,
    onDetect,
    sound,
  });

  // Tutup dengan Escape agar konsisten dengan modal lain.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const supported = isCameraAvailable();
  const message = !supported && !error
    ? (typeof window !== 'undefined' && window.isSecureContext === false
      ? CAMERA_ERRORS.insecure
      : CAMERA_ERRORS.unsupported)
    : error;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900/95 backdrop-blur-glass border border-white/10 w-full max-w-lg rounded-ios shadow-glass overflow-hidden animate-fade-in flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Camera size={18} className="text-ios-green" /> {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            aria-label="Tutup"
          >
            <X size={20} />
          </button>
        </div>

        <div className="relative bg-black aspect-[4/3] flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            className={`w-full h-full object-cover ${ready && !message ? 'opacity-100' : 'opacity-0'}`}
            muted
            playsInline
          />

          {/* Overlay bingkai pemindaian. */}
          {ready && !message && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative w-[78%] h-[38%] rounded-lg border-2 border-ios-green/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]">
                <span className="absolute -top-px left-0 right-0 h-0.5 bg-ios-green animate-pulse" />
              </div>
            </div>
          )}

          {message && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <CameraOff size={36} className="text-ios-red" />
              <p className="text-sm text-slate-300">{message}</p>
            </div>
          )}

          {!message && !ready && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm text-slate-400">Menyalakan kamera...</span>
            </div>
          )}
        </div>

        <div className="p-4 space-y-3 shrink-0">
          <p className="text-xs text-slate-400">
            Arahkan kamera ke barcode. Hasil terbaca otomatis tanpa menekan tombol.
          </p>
          {devices.length > 1 && (
            <select
              className="w-full bg-slate-950/60 border border-white/10 rounded-ios-sm px-3 py-2 text-sm text-white focus:outline-none focus:border-ios-blue/60"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              <option value="">Kamera belakang (otomatis)</option>
              {devices.map((device, index) => (
                <option key={device.deviceId || index} value={device.deviceId}>
                  {device.label || `Kamera ${index + 1}`}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
};

export default BarcodeScannerModal;

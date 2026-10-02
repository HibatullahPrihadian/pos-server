import { useCallback, useEffect, useRef, useState } from 'react';

// Format barcode retail 1D + QR yang kita minta. BarcodeDetector native dan
// ZXing memakai penamaan berbeda, sehingga dimap secara terpisah di bawah.
export const REQUESTED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'code_128', 'code_39', 'itf', 'qr_code'];

const ZXING_FORMATS = [
  'EAN_13',
  'EAN_8',
  'UPC_A',
  'CODE_128',
  'CODE_39',
  'ITF',
  'QR_CODE',
];

// Kode sama yang terdeteksi beruntun diabaikan selama jendela ini (ms).
// Kamera mengirim frame terus-menerus; tanpa debounce satu scan fisik bisa
// menghasilkan banyak hasil.
const DUPLICATE_WINDOW_MS = 1500;

// Pesan error yang ramah untuk kasir, dipetakan dari jenis kegagalan.
export const CAMERA_ERRORS = {
  insecure: 'Kamera butuh HTTPS. Buka aplikasi lewat alamat https:// atau localhost.',
  unsupported: 'Peramban ini tidak mendukung pemindaian kamera.',
  denied: 'Izin kamera ditolak. Aktifkan izin kamera untuk situs ini lalu coba lagi.',
  notfound: 'Kamera tidak ditemukan di perangkat ini.',
  notreadable: 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.',
  unknown: 'Kamera gagal dibuka. Coba lagi atau gunakan scanner USB.',
};

// Secure context menentukan apakah getUserMedia tersedia sama sekali.
const isCameraSupported = () =>
  typeof window !== 'undefined'
  && typeof navigator !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia);

export const isCameraAvailable = () =>
  typeof window !== 'undefined'
  // isSecureContext bisa undefined di peramban lama; hanya blokir bila eksplisit false.
  && window.isSecureContext !== false
  && isCameraSupported();

const mapCameraError = (err) => {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return CAMERA_ERRORS.denied;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return CAMERA_ERRORS.notfound;
  if (name === 'NotReadableError' || name === 'AbortError') return CAMERA_ERRORS.notreadable;
  return err?.message || CAMERA_ERRORS.unknown;
};

// Umpan balik getar + bunyi beep singkat lewat WebAudio (tanpa file aset).
const giveFeedback = (sound = true) => {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(120);
    }
  } catch {
    // getar opsional; abaikan bila tidak didukung.
  }

  if (!sound) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1200;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close().catch(() => {});
  } catch {
    // Audio opsional (mis. autoplay diblokir); abaikan.
  }
};

/**
 * Mengelola lifecycle pemindaian barcode lewat kamera.
 *
 * - `active` menyalakan/mematikan kamera. Set false saat modal tertutup supaya
 *   track benar-benar dihentikan (indikator kamera mati, baterai hemat).
 * - `onDetect(code)` dipanggil untuk tiap kode baru (setelah debounce).
 * - Deteksi memakai `BarcodeDetector` native bila tersedia, dan jatuh ke
 *   `@zxing/browser` (diimpor dinamis agar tidak masuk bundel utama) bila tidak.
 */
const useCameraBarcode = ({ active, onDetect, sound = true } = {}) => {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const zxingControlsRef = useRef(null);
  const nativeActiveRef = useRef(false);
  const lastCodeRef = useRef({ value: '', at: 0 });
  const detectRef = useRef(onDetect);
  detectRef.current = onDetect;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  // deviceId dibaca lewat ref oleh openStream agar fungsi tetap stabil (tidak
  // mengubah identitas tiap kali pemilih kamera berubah). Perubahan kamera
  // ditangani effect terpisah di bawah, bukan dengan restart seluruh pipeline.
  const deviceIdRef = useRef(deviceId);
  deviceIdRef.current = deviceId;

  const emit = useCallback((code) => {
    const now = Date.now();
    if (code === lastCodeRef.current.value && now - lastCodeRef.current.at < DUPLICATE_WINDOW_MS) {
      return;
    }
    lastCodeRef.current = { value: code, at: now };
    giveFeedback(soundRef.current);
    detectRef.current?.(code);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    nativeActiveRef.current = false;
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setReady(false);
  }, []);

  // Enumerasi kamera. Label hanya terisi setelah izin diberikan, jadi daftar
  // ini menyusul setelah stream pertama aktif.
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list.filter((d) => d.kind === 'videoinput');
      setDevices(cams);
    } catch {
      // Enumerasi gagal bukan kegagalan fatal; pemilih kamera cukup kosong.
    }
  }, []);

  // Pilih kamera belakang secara default: deviceId eksplisit dari pemilih,
  // atau facingMode environment, dengan fallback ke kamera apa pun.
  const openStream = useCallback(async () => {
    if (!isCameraSupported()) {
      setError(window.isSecureContext === false ? CAMERA_ERRORS.insecure : CAMERA_ERRORS.unsupported);
      return null;
    }

    const preferredId = deviceIdRef.current;
    const preferred = preferredId
      ? { deviceId: { exact: preferredId } }
      : { facingMode: { ideal: 'environment' } };

    const constraints = { audio: false, video: preferred };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      return stream;
    } catch (err) {
      // OverconstrainedError / NotFoundError dari kamera belakang: coba kamera apa pun.
      if (!preferredId && (err?.name === 'OverconstrainedError' || err?.name === 'NotFoundError')) {
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        } catch (fallbackErr) {
          setError(mapCameraError(fallbackErr));
          return null;
        }
      }
      setError(mapCameraError(err));
      return null;
    }
  }, []);

  // Loop deteksi native.
  const runNativeLoop = useCallback((detector, video) => {
    const tick = async () => {
      if (!streamRef.current || !videoRef.current) return;
      try {
        const results = await detector.detect(video);
        if (results && results.length > 0 && results[0].rawValue) {
          emit(results[0].rawValue);
        }
      } catch {
        // Error satu frame (mis. video belum siap) diabaikan; lanjut frame berikut.
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [emit]);

  // Menyalakan deteksi untuk stream yang sedang aktif. Native BarcodeDetector
  // membaca elemen video langsung, ZXing butuh objek stream. Kontrol ZXing dan
  // penanda loop native disimpan di ref (lihat atas) agar bisa dihentikan/diganti
  // saat kamera berganti tanpa membongkar effect siklus hidup.
  const stopZxing = useCallback(() => {
    const controls = zxingControlsRef.current;
    if (controls && typeof controls.stop === 'function') {
      try {
        controls.stop();
      } catch {
        // Kontrol ZXing mungkin sudah berhenti; abaikan.
      }
    }
    zxingControlsRef.current = null;
  }, []);

  const stopNative = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    nativeActiveRef.current = false;
  }, []);

  const startDetection = useCallback(async (stream, video) => {
    if (!stream || !video) return;

    // Native hanya perlu dinyalakan sekali; loop-nya membaca elemen video dan
    // tetap valid setelah kamera berganti, jadi jangan start loop kedua.
    if (nativeActiveRef.current) return;

    if ('BarcodeDetector' in window) {
      try {
        const all = await window.BarcodeDetector.getSupportedFormats();
        const formats = REQUESTED_FORMATS.filter((f) => all.includes(f));
        const detector = new window.BarcodeDetector({ formats });
        nativeActiveRef.current = true;
        runNativeLoop(detector, video);
        return;
      } catch {
        // Bila detektor native gagal dibuat, jatuh ke ZXing di bawah.
      }
    }

    // Fallback ZXing (jalur utama di iOS Safari). Import dinamis agar
    // pustaka hanya dimuat saat fitur kamera benar-benar dipakai.
    try {
      const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      if (streamRef.current !== stream) return;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS.map((f) => BarcodeFormat[f]));
      const reader = new BrowserMultiFormatReader(hints);
      zxingControlsRef.current = await reader.decodeFromStream(stream, video, (result) => {
        if (result?.getText()) emit(result.getText());
      });
    } catch (err) {
      if (streamRef.current === stream) setError(err?.message || CAMERA_ERRORS.unsupported);
    }
  }, [emit, runNativeLoop]);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      setError('');
      const stream = await openStream();
      if (cancelled || !stream) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      try {
        await video.play();
      } catch {
        // Autoplay bisa ditolak sesaat; deteksi tetap dicoba pada frame berikut.
      }
      if (cancelled) return;

      setReady(true);
      refreshDevices();
      await startDetection(stream, video);
    };

    if (active) start();
    else stop();

    return () => {
      cancelled = true;
      stopZxing();
      stopNative();
      stop();
    };
  // Semua dependency stabil (useCallback), jadi effect tidak restart pada render
  // ulang; openStream stabil karena deviceId dibaca via ref.
  }, [active, openStream, runNativeLoop, refreshDevices, stop, startDetection, stopZxing, stopNative]);

  // Ganti kamera: akuisisi stream baru dengan deviceId terbaru, pasang ke video
  // yang sama, lalu nyalakan ulang HANYA deteksi ZXing bila dipakai (loop native
  // membaca elemen video sehingga tetap jalan). Tidak membongkar effect siklus
  // hidup, jadi tidak ada blank/restart berulang saat operator memilih kamera.
  const firstDeviceEffectRef = useRef(true);
  useEffect(() => {
    if (firstDeviceEffectRef.current) {
      firstDeviceEffectRef.current = false;
      return;
    }
    if (!active) return undefined;
    let cancelled = false;
    (async () => {
      // ZXing terikat ke stream lama, jadi kontrolnya dihentikan lebih dulu; loop
      // native membaca elemen video sehingga tidak perlu dihentikan (dan
      // startDetection tidak akan memulai loop native kedua).
      stopZxing();
      const stream = await openStream();
      if (cancelled || !stream) {
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      const old = streamRef.current;
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay bisa ditolak sesaat; abaikan.
      }
      if (old) old.getTracks().forEach((t) => t.stop());
      if (!cancelled) await startDetection(stream, video);
    })();
    return () => { cancelled = true; };
  // Effect ini sengaja hanya bergantung pada deviceId; fungsi lain stabil.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return { videoRef, devices, deviceId, setDeviceId, error, ready };
};

export default useCameraBarcode;

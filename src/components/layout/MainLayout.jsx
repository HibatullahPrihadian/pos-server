import { useEffect, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BusinessPicker from './BusinessPicker';
import Spinner from '../ui/Spinner';
import { useBusiness } from '../../context/BusinessContext';
import useDeskMode from '../../hooks/useDeskMode';

const MainLayout = ({ children }) => {
  const { business, needsChoice } = useBusiness();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDesk = useDeskMode();

  // Pindah ke layout desktop (mis. rotate tablet / resize) menutup drawer agar
  // tidak tersisa terbuka saat kembali ke mode sempit.
  useEffect(() => {
    if (isDesk) setMobileOpen(false);
  }, [isDesk]);

  // Tahan mount halaman sampai mode usaha final: header X-Business dibaca dari
  // penyimpanan, sehingga request sebelum mode siap bisa salah usaha (403).
  if (!business) {
    return needsChoice
      ? <BusinessPicker />
      : <Spinner label="Menyiapkan mode usaha..." />;
  }

  // Owner dengan lebih dari satu usaha belum memilih mode: tampilkan pemilih
  // menggantikan seluruh UI (halaman anak tidak di-mount, jadi tidak ada request).
  if (needsChoice) return <BusinessPicker />;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1500px] mx-auto p-4 desk:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default MainLayout;

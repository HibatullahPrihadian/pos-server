import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BusinessPicker from './BusinessPicker';
import Spinner from '../ui/Spinner';
import { useBusiness } from '../../context/BusinessContext';

const MainLayout = ({ children }) => {
  const { business, needsChoice } = useBusiness();

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
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-[1500px] mx-auto p-6">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default MainLayout;

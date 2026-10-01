import Sidebar from './Sidebar';
import Topbar from './Topbar';

const MainLayout = ({ children }) => (
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

export default MainLayout;

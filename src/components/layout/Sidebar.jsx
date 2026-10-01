import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard, ShoppingCart, Receipt, Package, Tags, Truck, Boxes,
  ClipboardList, ShoppingBag, Users, Clock, BarChart3, UserCog, Settings,
  LogOut, ChevronLeft, ChevronRight, Lock, Store,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// Menu dikelompokkan; `adminOnly` menyembunyikan item dari kasir.
const MENU = [
  {
    section: 'Operasional',
    items: [
      { path: '/', name: 'Dashboard', icon: LayoutDashboard, adminOnly: true },
      { path: '/pos', name: 'Kasir', icon: ShoppingCart },
      { path: '/transactions', name: 'Transaksi', icon: Receipt },
      { path: '/shifts', name: 'Shift', icon: Clock },
    ],
  },
  {
    section: 'Inventori',
    items: [
      { path: '/products', name: 'Produk', icon: Package, adminOnly: true },
      { path: '/categories', name: 'Kategori', icon: Tags, adminOnly: true },
      { path: '/suppliers', name: 'Supplier', icon: Truck, adminOnly: true },
      { path: '/stock', name: 'Stok', icon: Boxes, adminOnly: true },
      { path: '/stock-opname', name: 'Opname', icon: ClipboardList, adminOnly: true },
      { path: '/purchases', name: 'Pembelian', icon: ShoppingBag, adminOnly: true },
    ],
  },
  {
    section: 'Pelanggan & Laporan',
    items: [
      { path: '/members', name: 'Member', icon: Users },
      { path: '/reports', name: 'Laporan', icon: BarChart3, adminOnly: true },
    ],
  },
  {
    section: 'Administrasi',
    items: [
      { path: '/users', name: 'Pengguna', icon: UserCog, adminOnly: true },
      { path: '/settings', name: 'Pengaturan', icon: Settings, adminOnly: true },
    ],
  },
];

const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div
      className={`h-screen bg-slate-900/65 backdrop-blur-glass text-slate-300 transition-all duration-300 flex flex-col border-r border-white/10 shrink-0 ${isCollapsed ? 'w-20' : 'w-64'}`}
    >
      <div className="p-4 flex items-center justify-between">
        {!isCollapsed && (
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Store size={20} className="text-ios-blue" />
            POS <span className="text-ios-blue">Mini</span>
          </h1>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`p-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white transition-all ${isCollapsed ? 'mx-auto' : ''}`}
          aria-label="Toggle sidebar"
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto pb-4">
        {MENU.map((group) => {
          const visible = group.items.filter((item) => !item.adminOnly || isAdmin);
          if (visible.length === 0) return null;

          return (
            <div key={group.section} className="mb-4">
              {!isCollapsed && (
                <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.section}
                </p>
              )}
              <div className="space-y-1">
                {visible.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        `flex items-center p-2.5 rounded-xl transition-colors text-sm ${isActive ? 'bg-ios-blue text-white shadow-glow-blue' : 'hover:bg-white/10 hover:text-white'} ${isCollapsed ? 'justify-center' : ''}`
                      }
                      title={isCollapsed ? item.name : undefined}
                    >
                      <Icon size={18} />
                      {!isCollapsed && <span className="ml-3 font-medium">{item.name}</span>}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10">
        {!isCollapsed ? (
          <div className="mb-2 px-2">
            <p className="text-sm font-medium text-white truncate">{user?.full_name}</p>
            <p className="text-xs text-slate-400 flex items-center gap-1">
              {isAdmin ? 'Administrator' : 'Kasir'} <Lock size={10} />
            </p>
          </div>
        ) : null}
        <button
          onClick={handleLogout}
          className={`flex items-center gap-2 w-full p-2.5 rounded-xl text-sm text-ios-red hover:bg-ios-red/10 transition-colors ${isCollapsed ? 'justify-center' : ''}`}
        >
          <LogOut size={18} />
          {!isCollapsed && <span>Keluar</span>}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;

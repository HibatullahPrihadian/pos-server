import { NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard, ShoppingCart, Receipt, Package, Tags, Truck, Boxes,
  ClipboardList, ShoppingBag, Users, Clock, BarChart3, UserCog, Settings,
  LogOut, ChevronLeft, ChevronRight, Lock, Store, BadgePercent, PackagePlus,
  HandCoins, CalendarCheck, LogIn, LogOut as LogOutIcon, Wallet, Building2, FileText,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import { useToastContext } from '../../context/ToastContext';

// Menu dikelompokkan; `permission` menyembunyikan item dari user tanpa izin.
const MENU = [
  {
    section: 'Operasional',
    items: [
      { path: '/', name: 'Dashboard', icon: LayoutDashboard, permission: 'report.view' },
      { path: '/pos', name: 'Kasir', icon: ShoppingCart, permission: 'pos.use' },
      { path: '/transactions', name: 'Transaksi', icon: Receipt, permission: 'pos.use' },
      { path: '/shifts', name: 'Shift', icon: Clock, permission: 'shift.use' },
      { path: '/attendance', name: 'Absensi', icon: CalendarCheck, permission: 'attendance.self' },
    ],
  },
  {
    section: 'Inventori',
    items: [
      { path: '/products', name: 'Produk', icon: Package, permission: 'product.view' },
      { path: '/promotions', name: 'Promo', icon: BadgePercent, permission: 'promotion.manage' },
      { path: '/bundles', name: 'Paket', icon: PackagePlus, permission: 'bundle.manage' },
      { path: '/consignment', name: 'Konsinyasi', icon: HandCoins, permission: 'consignment.manage' },
      { path: '/categories', name: 'Kategori', icon: Tags, permission: 'product.view' },
      { path: '/suppliers', name: 'Supplier', icon: Truck, permission: 'product.view' },
      { path: '/stock', name: 'Stok', icon: Boxes, permission: 'stock.view' },
      { path: '/stock-opname', name: 'Opname', icon: ClipboardList, permission: 'stock.view' },
      { path: '/purchases', name: 'Pembelian', icon: ShoppingBag, permission: 'purchase.view' },
      { path: '/expenses', name: 'Operasional', icon: Wallet, permission: 'expense.manage' },
    ],
  },
  {
    section: 'Pelanggan & Laporan',
    items: [
      { path: '/members', name: 'Member', icon: Users, permission: 'member.manage' },
      { path: '/customers', name: 'Pelanggan Grosir', icon: Building2, permission: 'customer.manage' },
      { path: '/invoices', name: 'Invoice Grosir', icon: FileText, permission: 'invoice.view' },
      { path: '/reports', name: 'Laporan', icon: BarChart3, permission: 'report.view' },
    ],
  },
  {
    section: 'Administrasi',
    items: [
      { path: '/users', name: 'Pengguna', icon: UserCog, permission: 'user.manage' },
      { path: '/settings', name: 'Pengaturan', icon: Settings, permission: 'settings.manage' },
    ],
  },
];

const ROLE_LABELS = { admin: 'Administrator', kasir: 'Kasir', gudang: 'Gudang' };

const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { user, can, logout } = useAuth();
  const toast = useToastContext();
  const navigate = useNavigate();

  // Absensi hari ini untuk tombol cepat di sidebar (kasir & admin).
  const [attendance, setAttendance] = useState(null);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const canAbsen = can('attendance.self');

  const loadAttendance = useCallback(async () => {
    if (!canAbsen) return;
    try {
      const rows = await api.get('/api/attendance/me');
      const today = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
      setAttendance((rows || []).find((r) => String(r.work_date).slice(0, 10) === todayIso) || null);
    } catch {
      // Diamkan: tombol absen tidak boleh menghalangi navigasi.
    }
  }, [canAbsen]);

  useEffect(() => { loadAttendance(); }, [loadAttendance]);

  const handleCheckIn = async () => {
    setAttendanceBusy(true);
    try {
      await api.post('/api/attendance/check-in', {});
      toast.success('Absen masuk tercatat');
      loadAttendance();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAttendanceBusy(false);
    }
  };

  const handleCheckOut = async () => {
    setAttendanceBusy(true);
    try {
      await api.post('/api/attendance/check-out', {});
      toast.success('Absen pulang tercatat');
      loadAttendance();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAttendanceBusy(false);
    }
  };

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
          const visible = group.items.filter((item) => can(item.permission));
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
              {ROLE_LABELS[user?.role] || 'Kasir'} <Lock size={10} />
            </p>
          </div>
        ) : null}

        {/* Absen masuk/pulang cepat. Setelah masuk & belum pulang, tampilkan tombol pulang. */}
        {canAbsen && (attendance?.check_in && !attendance?.check_out ? (
          <button
            onClick={handleCheckOut}
            disabled={attendanceBusy}
            className={`flex items-center gap-2 w-full p-2.5 mb-1 rounded-xl text-sm text-ios-orange hover:bg-ios-orange/10 transition-colors disabled:opacity-50 ${isCollapsed ? 'justify-center' : ''}`}
            title="Absen Pulang"
          >
            <LogOutIcon size={18} />
            {!isCollapsed && <span>Absen Pulang</span>}
          </button>
        ) : !attendance ? (
          <button
            onClick={handleCheckIn}
            disabled={attendanceBusy}
            className={`flex items-center gap-2 w-full p-2.5 mb-1 rounded-xl text-sm text-ios-green hover:bg-ios-green/10 transition-colors disabled:opacity-50 ${isCollapsed ? 'justify-center' : ''}`}
            title="Absen Masuk"
          >
            <LogIn size={18} />
            {!isCollapsed && <span>Absen Masuk</span>}
          </button>
        ) : (
          !isCollapsed && (
            <div className="px-2 mb-1 text-xs text-slate-500 flex items-center gap-1">
              <CalendarCheck size={12} /> Absensi hari ini selesai
            </div>
          )
        ))}

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

import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import TodayScreen from './screens/TodayScreen';
import MorningBossScreen from './screens/MorningBossScreen';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import SettingsScreen from './screens/SettingsScreen';
import VariantsScreen from './screens/VariantsScreen';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import NotFoundScreen from './screens/NotFoundScreen';
import VendorSlider from './components/VendorSlider';
import { BarChart3, Bell, CarFront, Database, Home, Layers, PlusCircle, Settings } from 'lucide-react';
import { getUnreadNotificationsCount, initNotificationsFromServer } from './notificationCenter';
import { LOCAL_MODE_LABEL } from './localMode';
import { DebugRouteBoundary } from './screens/DebugRouteBoundary';
import { playSound } from './utils/sounds';
import { DrawerContext } from './DrawerContext';

const DebugLogsScreen = lazy(() => import('./screens/DebugLogsScreen'));

const HashPublicQuoteRoute: React.FC = () => {
  const { orderId = '' } = useParams();
  return <PublicQuoteScreen orderId={orderId} />;
};

type BottomTab = 'today' | 'orders' | 'analytics' | null;

const resolveBottomTab = (pathname: string): BottomTab => {
  if (pathname === '/') return 'today';
  if (pathname === '/orders' || pathname.startsWith('/order/')) return 'orders';
  if (pathname.startsWith('/variants')) return 'analytics';
  return null;
};

const DrawerMenu: React.FC<{ isOpen: boolean; onClose: () => void; unreadCount: number }> = ({ isOpen, onClose, unreadCount }) => {
  const navigate = useNavigate();
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  const menuItems: Array<{ icon: React.ReactNode; label: string; path: string; badge?: string }> = [
    { icon: <Layers size={20} />, label: 'Vendor Slides', path: '/vendor' },
    { icon: <PlusCircle size={20} />, label: 'Новый заказ', path: '/new' },
    { icon: <Database size={20} />, label: 'Поставщики', path: '/database' },
    { icon: <Bell size={20} />, label: 'Уведомления', path: '/notifications', badge: unreadCount > 0 ? badgeLabel : undefined },
    { icon: <Settings size={20} />, label: 'Настройки', path: '/settings' },
  ];

  const handleNavigate = (path: string) => {
    onClose();
    playSound('navigate');
    navigate(path);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 z-[82] bg-black/50 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      {/* Drawer panel – slides in from the right */}
      <div
        className={`absolute top-0 right-0 h-full z-[83] bg-[#1E1E1E] w-4/5 max-w-xs transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="px-4 pb-8" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
          <h2 className="text-white text-lg font-black mb-6 px-2">Меню</h2>
          <nav className="space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.path}
                type="button"
                onClick={() => handleNavigate(item.path)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-300 hover:bg-white/10 active:bg-white/20 transition-colors text-left"
              >
                <span className="text-gray-400 shrink-0">{item.icon}</span>
                <span className="flex-1 text-sm font-semibold">{item.label}</span>
                {item.badge && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  // Show bottom nav only on the 3 tab screens (and order details, which stays in Orders context)
  const hideNav = resolveBottomTab(location.pathname) === null;

  const [unreadCount, setUnreadCount] = useState(() => getUnreadNotificationsCount());
  const [tabPaths, setTabPaths] = useState<Record<Exclude<BottomTab, null>, string>>({
    today: '/',
    orders: '/orders',
    analytics: '/variants',
  });

  useEffect(() => {
    const tab = resolveBottomTab(location.pathname);
    if (!tab) return;
    setTabPaths((prev) => (prev[tab] === location.pathname ? prev : { ...prev, [tab]: location.pathname }));
  }, [location.pathname]);

  useEffect(() => {
    const updateUnread = () => setUnreadCount(getUnreadNotificationsCount());

    updateUnread();
    window.addEventListener('notifications:changed', updateUnread);
    window.addEventListener('focus', updateUnread);
    document.addEventListener('visibilitychange', updateUnread);

    return () => {
      window.removeEventListener('notifications:changed', updateUnread);
      window.removeEventListener('focus', updateUnread);
      document.removeEventListener('visibilitychange', updateUnread);
    };
  }, []);

  const handleTabNavigate = (tab: Exclude<BottomTab, null>) => {
    const rootByTab: Record<Exclude<BottomTab, null>, string> = {
      today: '/',
      orders: '/orders',
      analytics: '/variants',
    };

    const activeTab = resolveBottomTab(location.pathname);
    if (activeTab === tab) {
      navigate(rootByTab[tab]);
      return;
    }

    const destination = tabPaths[tab] || rootByTab[tab];
    navigate(destination);
  };

  return (
    <DrawerContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
      <div className="fixed inset-0 h-[100dvh] w-full bg-slate-100 flex justify-center overflow-hidden"><div className="h-full w-full max-w-md bg-gray-50 flex flex-col overflow-hidden shadow-sm relative">
        <DrawerMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} unreadCount={unreadCount} />
        <div title="Cloud sync status" className="fixed top-3 right-3 z-[90] px-2.5 py-1 rounded-full bg-slate-700/85 text-white text-[10px] font-black uppercase tracking-wide shadow">
          {LOCAL_MODE_LABEL}
        </div>
        <main className="flex-1 overflow-y-auto no-scrollbar relative">
          {children}
        </main>
        {!hideNav && (
          <nav className="h-16 bg-white border-t border-gray-200 flex items-center justify-around px-2 pb-safe shrink-0 z-50">
            <NavLink to={tabPaths.today} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('today'); }} className={() => `flex flex-col items-center gap-1 ${resolveBottomTab(location.pathname) === 'today' ? 'text-blue-600' : 'text-gray-400'}`}><Home size={22} /><span className="text-[10px] font-medium">Главная</span></NavLink>
            <NavLink to={tabPaths.orders} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('orders'); }} className={() => `flex flex-col items-center gap-1 ${resolveBottomTab(location.pathname) === 'orders' ? 'text-blue-600' : 'text-gray-400'}`}><CarFront size={24} /><span className="text-[10px] font-medium">Заказы</span></NavLink>
            <NavLink to={tabPaths.analytics} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('analytics'); }} className={() => `flex flex-col items-center gap-1 ${resolveBottomTab(location.pathname) === 'analytics' ? 'text-blue-600' : 'text-gray-400'}`}><BarChart3 size={22} /><span className="text-[10px] font-medium">Варианты</span></NavLink>
          </nav>
        )}
        </div>
      </div>
    </DrawerContext.Provider>
  );
};

const CachedRoutes: React.FC = () => {
  const location = useLocation();
  const [cachedPaths, setCachedPaths] = useState<string[]>(() => [location.pathname]);

  useEffect(() => {
    setCachedPaths((prev) => (prev.includes(location.pathname) ? prev : [...prev, location.pathname]));
  }, [location.pathname]);

  const stablePaths = useMemo(() => cachedPaths, [cachedPaths]);

  return (
    <>
      {stablePaths.map((pathname) => {
        const isActive = pathname === location.pathname;
        const keepMountedWhenHidden = pathname !== '/vendor';
        if (!isActive && !keepMountedWhenHidden) return null;
        return (
          <div key={pathname} className={isActive ? 'h-full' : 'hidden'}>
            <Routes location={{ ...location, pathname }}>
              <Route path="/" element={<TodayScreen />} />
              <Route path="/morning" element={<MorningBossScreen />} />
              <Route path="/orders" element={<OrdersScreen />} />
              <Route path="/new" element={<NewOrderScreen />} />
              <Route path="/vendor" element={<Navigate to="/vendor/slider" replace />} />
              <Route path="/vendor/slider" element={<VendorSlider />} />
              <Route path="/order/:id" element={<OrderDetailsScreen />} />
              <Route path="/order/:orderId/part/:partId" element={<PartDetailsScreen />} />
              <Route path="/database" element={<SuppliersScreen />} />
              <Route path="/variants" element={<VariantsScreen />} />
              <Route path="/notifications" element={<NotificationsScreen />} />
              <Route
                path="/debug"
                element={(
                  <DebugRouteBoundary>
                    <Suspense fallback={<div className="p-4 text-xs text-gray-500">Loading debug tools…</div>}>
                      <DebugLogsScreen />
                    </Suspense>
                  </DebugRouteBoundary>
                )}
              />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/request" element={<PublicOrderFormScreen />} />
              <Route path="/order-form" element={<PublicOrderFormScreen />} />
              <Route path="/public-order-form" element={<PublicOrderFormScreen />} />
              <Route path="/q/:orderId" element={<HashPublicQuoteRoute />} />
              <Route path="*" element={<NotFoundScreen />} />
            </Routes>
          </div>
        );
      })}
    </>
  );
};

const App: React.FC = () => {
  const [savePulse, setSavePulse] = useState(false);
  const [appToast, setAppToast] = useState<{ message: string; tone: 'error' | 'success' | 'info' } | null>(null);
  const [isBooting, setIsBooting] = useState(true);

  useEffect(() => {
    const bootTimer = window.setTimeout(() => setIsBooting(false), 240);
    return () => window.clearTimeout(bootTimer);
  }, []);

  useEffect(() => {
    void initNotificationsFromServer();
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onSave = () => {
      setSavePulse(true);
      playSound('success');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSavePulse(false), 950);
    };

    window.addEventListener('cloud-save-success', onSave);
    return () => {
      window.removeEventListener('cloud-save-success', onSave);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let toastTimer: number | null = null;
    const onAppToast = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string; tone?: 'error' | 'success' | 'info' }>;
      const message = custom.detail?.message;
      if (!message) return;
      const tone = custom.detail?.tone || 'info';
      setAppToast({ message, tone });
      if (tone === 'success') playSound('success');
      else if (tone === 'error') playSound('error');
      else playSound('tap');
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => setAppToast(null), 3200);
    };

    window.addEventListener('app-toast', onAppToast);
    return () => {
      window.removeEventListener('app-toast', onAppToast);
      if (toastTimer) window.clearTimeout(toastTimer);
    };
  }, []);








  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const target = e.target as HTMLInputElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
        e.preventDefault();
        const form = target.form;
        if (form) {
          const index = Array.prototype.indexOf.call(form, target);
          const next = form.elements[index + 1] as HTMLElement;
          if (next) next.focus({ preventScroll: true });
          else target.blur();
        }
      }
    }
  };

  const normalizedPath = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const isDirectPublicOrderFormPath = normalizedPath.endsWith('/request') || normalizedPath.endsWith('/order-form') || normalizedPath.endsWith('/public-order-form');

  if (isDirectPublicOrderFormPath) {
    return <PublicOrderFormScreen />;
  }

  return (
    <div onKeyDown={handleKeyDown}>
      <div className={`transition-all duration-500 ${isBooting ? 'opacity-0 scale-[0.985]' : 'opacity-100'}`}>
        <div className={`fixed top-3 right-3 z-[90] pointer-events-none transition-all duration-700 ${savePulse ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
          <div className="px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-[10px] font-black uppercase tracking-wider shadow-lg">
            Сохранено
          </div>
        </div>



        {appToast && (
          <div
            className={`fixed top-14 left-1/2 -translate-x-1/2 z-[95] px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wide shadow ${
              appToast.tone === 'error'
                ? 'bg-rose-100 text-rose-700'
                : appToast.tone === 'success'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {appToast.message}
          </div>
        )}

        <HashRouter>
          <Layout>
            <CachedRoutes />
          </Layout>
        </HashRouter>
      </div>
    </div>
  );
};

export default App;

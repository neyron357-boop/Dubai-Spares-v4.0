import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import MorningBossScreen from './screens/MorningBossScreen';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import OrderPartsScreen from './screens/OrderPartsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import SettingsScreen from './screens/SettingsScreen';
import VariantsScreen from './screens/VariantsScreen';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import NotFoundScreen from './screens/NotFoundScreen';
import VendorSlider from './components/VendorSlider';
import VendorSlidesScreen from './screens/VendorSlidesScreen';
import { Bell, CarFront, Layers, PlusCircle, Settings } from 'lucide-react';
import { getUnreadNotificationsCount, initNotificationsFromServer } from './notificationCenter';
import { DebugRouteBoundary } from './screens/DebugRouteBoundary';
import { playSound } from './utils/sounds';

const DebugLogsScreen = lazy(() => import('./screens/DebugLogsScreen'));

const HashPublicQuoteRoute: React.FC = () => {
  const { orderId = '' } = useParams();
  return <PublicQuoteScreen orderId={orderId} />;
};

type BottomTab = 'orders' | 'vendors' | 'notifications' | 'settings' | null;

const resolveBottomTab = (pathname: string): BottomTab => {
  if (pathname === '/orders' || pathname.startsWith('/order/') || pathname === '/new') return 'orders';
  if (pathname.startsWith('/database') || pathname.startsWith('/variants')) return 'vendors';
  if (pathname.startsWith('/notifications')) return 'notifications';
  if (pathname.startsWith('/settings')) return 'settings';
  return null;
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const prevPathname = useRef(location.pathname);

  // Show bottom nav only on the tab screens (and order details, which stays in Orders context)
  const hideNav = resolveBottomTab(location.pathname) === null;

  const [unreadCount, setUnreadCount] = useState(() => getUnreadNotificationsCount());
  const [tabPaths, setTabPaths] = useState<Record<Exclude<BottomTab, null>, string>>({
    orders: '/orders',
    vendors: '/database',
    notifications: '/notifications',
    settings: '/settings',
  });

  // Save scroll position when navigating away, restore when coming back
  useEffect(() => {
    const prev = prevPathname.current;
    const next = location.pathname;
    if (prev === next) return;

    if (mainRef.current) {
      scrollPositions.current[prev] = mainRef.current.scrollTop;
    }
    prevPathname.current = next;

    const savedPos = scrollPositions.current[next] ?? 0;
    window.requestAnimationFrame(() => {
      if (mainRef.current) {
        mainRef.current.scrollTop = savedPos;
      }
    });
  }, [location.pathname]);

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
      orders: '/orders',
      vendors: '/database',
      notifications: '/notifications',
      settings: '/settings',
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
      <div className="fixed inset-0 h-[100dvh] w-full bg-slate-100 flex justify-center overflow-hidden"><div className="h-full w-full max-w-md bg-gray-50 flex flex-col overflow-hidden shadow-sm relative">
        <main ref={mainRef} className="flex-1 overflow-y-auto no-scrollbar relative">
          {children}
        </main>
        {!hideNav && (
          <nav className="h-16 bg-white border-t border-gray-200 flex items-end justify-around px-2 pb-safe shrink-0 z-50 overflow-visible">
            <NavLink to={tabPaths.orders} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('orders'); }} className={() => `flex flex-col items-center gap-1 pb-1 ${resolveBottomTab(location.pathname) === 'orders' ? 'text-blue-600' : 'text-gray-400'}`}><CarFront size={24} /><span className="text-[10px] font-medium">Заказы</span></NavLink>
            <NavLink to={tabPaths.vendors} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('vendors'); }} className={() => `flex flex-col items-center gap-1 pb-1 ${resolveBottomTab(location.pathname) === 'vendors' ? 'text-blue-600' : 'text-gray-400'}`}><Layers size={22} /><span className="text-[10px] font-medium">Поставщики</span></NavLink>
            {/* Center: New Order FAB */}
            <button
              type="button"
              onClick={() => { playSound('navigate'); navigate('/new'); }}
              className="flex flex-col items-center gap-0.5 -translate-y-3"
              aria-label="Новый заказ"
            >
              <span className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center shadow-lg border-[3px] border-white">
                <PlusCircle size={26} className="text-white" />
              </span>
              <span className="text-[10px] font-medium text-gray-500">Новый</span>
            </button>
            <NavLink to={tabPaths.notifications} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('notifications'); }} className={() => `flex flex-col items-center gap-1 pb-1 relative ${resolveBottomTab(location.pathname) === 'notifications' ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="relative"><Bell size={22} />{unreadCount > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-rose-500 text-white text-[8px] font-black flex items-center justify-center">{unreadCount > 99 ? '99+' : unreadCount}</span>}</span>
              <span className="text-[10px] font-medium">Оповещения</span>
            </NavLink>
            <NavLink to={tabPaths.settings} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('settings'); }} className={() => `flex flex-col items-center gap-1 pb-1 ${resolveBottomTab(location.pathname) === 'settings' ? 'text-blue-600' : 'text-gray-400'}`}><Settings size={22} /><span className="text-[10px] font-medium">Настройки</span></NavLink>
          </nav>
        )}
        </div>
      </div>
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
        const keepMountedWhenHidden = !pathname.startsWith('/vendor');
        if (!isActive && !keepMountedWhenHidden) return null;
        return (
          <div key={pathname} className={isActive ? 'h-full' : 'hidden'}>
            <Routes location={{ ...location, pathname }}>
              <Route path="/" element={<Navigate to="/orders" replace />} />
              <Route path="/morning" element={<MorningBossScreen />} />
              <Route path="/orders" element={<OrdersScreen />} />
              <Route path="/new" element={<NewOrderScreen />} />
              <Route path="/vendor" element={<VendorSlidesScreen />} />
              <Route path="/vendor/slider" element={<VendorSlider />} />
              <Route path="/order/:id" element={<OrderDetailsScreen />} />
              <Route path="/order/:orderId/parts" element={<OrderPartsScreen />} />
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

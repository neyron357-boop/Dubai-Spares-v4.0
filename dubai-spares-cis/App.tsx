import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { HashRouter, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import SettingsScreen from './screens/SettingsScreen';
import VariantsScreen from './screens/VariantsScreen';
import TodayScreen from './screens/TodayScreen';
import AnalyticsScreen from './screens/AnalyticsScreen';
import RouteScreen from './screens/RouteScreen';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import NotFoundScreen from './screens/NotFoundScreen';
import VendorSlider from './components/VendorSlider';
import { BarChart3, Bell, CarFront, MapPin, MoreHorizontal, Package, Plus, Settings, Store } from 'lucide-react';
import { getUnreadNotificationsCount, initNotificationsFromServer } from './notificationCenter';
import { LOCAL_MODE_LABEL } from './localMode';
import { DebugRouteBoundary } from './screens/DebugRouteBoundary';
import { playSound } from './utils/sounds';

const DebugLogsScreen = lazy(() => import('./screens/DebugLogsScreen'));

const HashPublicQuoteRoute: React.FC = () => {
  const { orderId = '' } = useParams();
  return <PublicQuoteScreen orderId={orderId} />;
};

type BottomTab = 'today' | 'orders' | 'new' | 'analytics' | 'database' | 'variants' | 'notifications' | 'settings' | null;

const resolveBottomTab = (pathname: string): BottomTab => {
  if (pathname.startsWith('/today')) return 'today';
  if (pathname === '/' || pathname.startsWith('/order/') || pathname.startsWith('/vendor')) return 'orders';
  if (pathname.startsWith('/new')) return 'new';
  if (pathname.startsWith('/analytics')) return 'analytics';
  if (pathname.startsWith('/database')) return 'database';
  if (pathname.startsWith('/variants')) return 'variants';
  if (pathname.startsWith('/notifications')) return 'notifications';
  if (pathname.startsWith('/settings')) return 'settings';
  return null;
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const hideNav = location.pathname.includes('/estimate')
    || location.pathname.includes('/vendor')
    || location.pathname.includes('/request')
    || location.pathname.includes('/order-form')
    || location.pathname.includes('/public-order-form');
  const [unreadCount, setUnreadCount] = useState(() => getUnreadNotificationsCount());
  const [moreOpen, setMoreOpen] = useState(false);
  const [tabPaths, setTabPaths] = useState<Record<Exclude<BottomTab, null>, string>>({
    today: '/today',
    orders: '/',
    new: '/new',
    analytics: '/analytics',
    database: '/database',
    variants: '/variants',
    notifications: '/notifications',
    settings: '/settings'
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

  // Close "more" sheet whenever route changes
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  const handleTabNavigate = (tab: Exclude<BottomTab, null>) => {
    const rootByTab: Record<Exclude<BottomTab, null>, string> = {
      today: '/today',
      orders: '/',
      new: '/new',
      analytics: '/analytics',
      database: '/database',
      variants: '/variants',
      notifications: '/notifications',
      settings: '/settings'
    };

    const activeTab = resolveBottomTab(location.pathname);
    if (activeTab === tab) {
      navigate(rootByTab[tab]);
      return;
    }

    const destination = tabPaths[tab] || rootByTab[tab];
    navigate(destination);
  };

  const activeTab = resolveBottomTab(location.pathname);
  // "Ещё" button is highlighted when on a sheet-screen
  const isMoreActive = activeTab === 'analytics' || activeTab === 'notifications' || activeTab === 'settings';

  const tabCls = (active: boolean) =>
    `flex-1 flex flex-col items-center justify-center gap-[3px] h-full transition-colors ${active ? 'text-blue-600' : 'text-gray-400'}`;

  return (
    <div className="fixed inset-0 h-[100dvh] w-full bg-slate-100 flex justify-center overflow-hidden"><div className="h-full w-full max-w-md bg-gray-50 flex flex-col overflow-hidden shadow-sm">
      <main className="flex-1 overflow-y-auto no-scrollbar relative">
        <div title="Cloud sync status" className="fixed top-3 right-3 z-[90] px-2.5 py-1 rounded-full bg-slate-700/85 text-white text-[10px] font-black uppercase tracking-wide shadow">
          {LOCAL_MODE_LABEL}
        </div>
        {children}
      </main>

      {!hideNav && (
        <>
          {/* ── FAB ── fixed, centered; bottom-[42px] = overlaps ~22px into h-16 tab bar (Uber style) */}
          <button
            onClick={() => { playSound('navigate'); handleTabNavigate('new'); }}
            className="fixed bottom-[42px] left-1/2 -translate-x-1/2 z-[55] w-14 h-14 rounded-full bg-blue-600 shadow-xl active:scale-95 transition-transform flex items-center justify-center"
            aria-label="Новый заказ"
          >
            <Plus size={26} color="white" strokeWidth={2.5} />
          </button>

          {/* ── Tab bar ── */}
          <nav className="h-16 bg-white border-t border-gray-200 flex items-stretch pb-safe shrink-0 z-50">

            {/* Заказы */}
            <button onClick={() => { playSound('navigate'); handleTabNavigate('orders'); }} className={tabCls(activeTab === 'orders')}>
              <CarFront size={22} strokeWidth={activeTab === 'orders' ? 2.5 : 1.8} />
              <span className="text-[9px] font-semibold">Заказы</span>
            </button>

            {/* Разборки */}
            <button onClick={() => { playSound('navigate'); handleTabNavigate('today'); }} className={tabCls(activeTab === 'today')}>
              <MapPin size={22} strokeWidth={activeTab === 'today' ? 2.5 : 1.8} />
              <span className="text-[9px] font-semibold">Разборки</span>
            </button>

            {/* Center spacer — FAB floats above this slot */}
            <div className="w-16 shrink-0 flex flex-col items-center justify-end pb-[5px]">
              <span className="text-[10px] font-semibold text-blue-600 leading-none">Новый заказ</span>
            </div>

            {/* Поставщики */}
            <button onClick={() => { playSound('navigate'); handleTabNavigate('database'); }} className={tabCls(activeTab === 'database')}>
              <Store size={22} strokeWidth={activeTab === 'database' ? 2.5 : 1.8} />
              <span className="text-[9px] font-semibold">Поставщики</span>
            </button>

            {/* Варианты */}
            <button onClick={() => { playSound('navigate'); handleTabNavigate('variants'); }} className={tabCls(activeTab === 'variants')}>
              <Package size={22} strokeWidth={activeTab === 'variants' ? 2.5 : 1.8} />
              <span className="text-[9px] font-semibold">Варианты</span>
            </button>

            {/* Ещё */}
            <button onClick={() => { playSound('tap'); setMoreOpen(true); }} className={tabCls(isMoreActive || moreOpen)}>
              <MoreHorizontal size={22} strokeWidth={(isMoreActive || moreOpen) ? 2.5 : 1.8} />
              <span className="text-[9px] font-semibold">Ещё</span>
            </button>

          </nav>

          {/* ── "Ещё" bottom sheet ── */}
          {moreOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-[65] bg-black/40"
                onClick={() => setMoreOpen(false)}
              />
              {/* Sheet */}
              <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-[70] bg-white rounded-t-2xl shadow-2xl">
                {/* Drag handle */}
                <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-1" />

                {/* Уведомления */}
                <button
                  onClick={() => { playSound('navigate'); handleTabNavigate('notifications'); setMoreOpen(false); }}
                  className="relative flex items-center gap-3 w-full px-5 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <Bell size={20} className={activeTab === 'notifications' ? 'text-blue-600' : 'text-gray-500'} />
                  <span className={`text-sm font-medium ${activeTab === 'notifications' ? 'text-blue-600' : 'text-gray-800'}`}>Уведомления</span>
                  {unreadCount > 0 && (
                    <span className="ml-auto min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
                      {badgeLabel}
                    </span>
                  )}
                </button>

                {/* Аналитика */}
                <button
                  onClick={() => { playSound('navigate'); handleTabNavigate('analytics'); setMoreOpen(false); }}
                  className="flex items-center gap-3 w-full px-5 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <BarChart3 size={20} className={activeTab === 'analytics' ? 'text-blue-600' : 'text-gray-500'} />
                  <span className={`text-sm font-medium ${activeTab === 'analytics' ? 'text-blue-600' : 'text-gray-800'}`}>Аналитика</span>
                </button>

                {/* Настройки */}
                <button
                  onClick={() => { playSound('navigate'); handleTabNavigate('settings'); setMoreOpen(false); }}
                  className="flex items-center gap-3 w-full px-5 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <Settings size={20} className={activeTab === 'settings' ? 'text-blue-600' : 'text-gray-500'} />
                  <span className={`text-sm font-medium ${activeTab === 'settings' ? 'text-blue-600' : 'text-gray-800'}`}>Настройки</span>
                </button>

                <div className="h-4 pb-safe" />
              </div>
            </>
          )}
        </>
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
        const keepMountedWhenHidden = pathname !== '/vendor';
        if (!isActive && !keepMountedWhenHidden) return null;
        return (
          <div key={pathname} className={isActive ? 'h-full' : 'hidden'}>
            <Routes location={{ ...location, pathname }}>
              <Route path="/" element={<OrdersScreen />} />
              <Route path="/today" element={<TodayScreen />} />
              <Route path="/analytics" element={<AnalyticsScreen />} />
              <Route path="/route/:zone" element={<RouteScreen />} />
              <Route path="/new" element={<NewOrderScreen />} />
              <Route path="/vendor" element={<VendorSlider />} />
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

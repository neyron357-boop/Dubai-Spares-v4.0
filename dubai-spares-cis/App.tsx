import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import NotFoundScreen from './screens/NotFoundScreen';
import { CarFront, Check, Layers, PlusCircle, RefreshCw, Settings, UserRound } from 'lucide-react';
import { initNotificationsFromServer } from './notificationCenter';
import { DebugRouteBoundary } from './screens/DebugRouteBoundary';
import { DebugIndex, DebugIndexProvider, useDebugIndex } from './components/DebugIndex';
import { playSound } from './utils/sounds';
import { useStore } from './store';
import { isLeadOrder, isUnreadLeadOrder } from './utils/orderClassification';

const DebugLogsScreen = lazy(() => import('./screens/DebugLogsScreen'));
const MorningBossScreen = lazy(() => import('./screens/MorningBossScreen'));
const LeadsScreen = lazy(() => import('./screens/LeadsScreen'));
const NewOrderScreen = lazy(() => import('./screens/NewOrderScreen'));
const OrderDetailsScreen = lazy(() => import('./screens/OrderDetailsScreen'));
const PartDetailsScreen = lazy(() => import('./screens/PartDetailsScreen'));
const OrderPartsScreen = lazy(() => import('./screens/OrderPartsScreen'));
const SuppliersScreen = lazy(() => import('./screens/SuppliersScreen'));
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const VariantsScreen = lazy(() => import('./screens/VariantsScreen'));
const ClientTrustScreen = lazy(() => import('./screens/ClientTrustScreen'));

const RouteFallback: React.FC = () => (
  <div className="flex min-h-[60dvh] items-center justify-center p-4 text-xs font-bold uppercase tracking-wide text-slate-400">
    Loading...
  </div>
);

const HashPublicQuoteRoute: React.FC = () => {
  const { orderId = '' } = useParams();
  return <PublicQuoteScreen orderId={orderId} />;
};

type BottomTab = 'orders' | 'vendors' | 'leads' | 'settings' | null;

const resolveBottomTab = (pathname: string): BottomTab => {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/orders' || normalizedPath.startsWith('/order/') || normalizedPath === '/new') return 'orders';
  if (normalizedPath.startsWith('/database') || normalizedPath.startsWith('/variants')) return 'vendors';
  if (normalizedPath.startsWith('/leads')) return 'leads';
  if (normalizedPath.startsWith('/settings')) return 'settings';
  return null;
};

const MobileLayoutContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-[100dvh] w-full bg-slate-100">
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-gray-50 shadow-sm">
      {children}
    </div>
  </div>
);

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toggle } = useDebugIndex();
  const location = useLocation();
  const navigate = useNavigate();
  const { orders, fetchOrders, fetchOrderDetails } = useStore();
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const prevPathname = useRef(location.pathname);
  const pullStartYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const isOrderWorkspace = /^\/order\/[^/]+(?:\/parts|\/part\/[^/]+)?$/.test(location.pathname.replace(/\/+$/, ''));
  const hideNav = resolveBottomTab(location.pathname) === null || isOrderWorkspace;

  const leadNavStats = useMemo(() => ({
    total: orders.filter((order) => !order.isArchived && !order.isSold && isLeadOrder(order)).length,
    unread: orders.filter((order) => !order.isSold && isUnreadLeadOrder(order)).length
  }), [orders]);

  const [tabPaths, setTabPaths] = useState<Record<Exclude<BottomTab, null>, string>>({
    orders: '/orders',
    vendors: '/database',
    leads: '/leads',
    settings: '/settings',
  });

  // Save scroll position when navigating away, restore when coming back
  useEffect(() => {
    const prev = prevPathname.current;
    const next = location.pathname;
    if (prev === next) return;

    scrollPositions.current[prev] = window.scrollY;
    prevPathname.current = next;

    const savedPos = scrollPositions.current[next] ?? 0;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: savedPos, left: 0, behavior: 'auto' });
    });
  }, [location.pathname]);

  useEffect(() => {
    const tab = resolveBottomTab(location.pathname);
    if (!tab) return;
    setTabPaths((prev) => (prev[tab] === location.pathname ? prev : { ...prev, [tab]: location.pathname }));
  }, [location.pathname]);

  const handleTabNavigate = (tab: Exclude<BottomTab, null>) => {
    const rootByTab: Record<Exclude<BottomTab, null>, string> = {
      orders: '/orders',
      vendors: '/database',
      leads: '/leads',
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

  const tabBarHeightClass = 'h-[calc(64px+env(safe-area-inset-bottom))]';
  const tabBarBottomOffsetClass = 'pb-[calc(88px+env(safe-area-inset-bottom))]';
  const tabBarPaddingBottomClass = 'pb-[max(8px,env(safe-area-inset-bottom))]';
  const pullProgress = Math.min(1, pullDistance / 78);

  const refreshCurrentScreen = async () => {
    if (isPullRefreshing) return;
    setIsPullRefreshing(true);
    try {
      const orderMatch = location.pathname.match(/^\/order\/([^/]+)/);
      if (orderMatch?.[1]) {
        await fetchOrderDetails(orderMatch[1]);
      } else {
        await fetchOrders();
      }
    } finally {
      setPullDistance(0);
      setIsPullRefreshing(false);
    }
  };

  const handlePullStart = (event: React.TouchEvent<HTMLElement>) => {
    if (isPullRefreshing || window.scrollY > 0 || (mainRef.current?.scrollTop || 0) > 0) return;
    pullStartYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handlePullMove = (event: React.TouchEvent<HTMLElement>) => {
    if (pullStartYRef.current === null) return;
    const currentY = event.touches[0]?.clientY ?? pullStartYRef.current;
    const rawDistance = currentY - pullStartYRef.current;
    if (rawDistance <= 0) {
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(98, rawDistance * 0.55));
  };

  const handlePullEnd = () => {
    const shouldRefresh = pullDistance >= 78;
    pullStartYRef.current = null;
    if (shouldRefresh) {
      void refreshCurrentScreen();
      return;
    }
    setPullDistance(0);
  };

  return (
      <MobileLayoutContainer>
        <DebugIndex indexId="1.01">
        <main
          ref={mainRef}
          className={`flex-1 min-h-0 overscroll-contain no-scrollbar relative ${hideNav ? 'pb-0' : tabBarBottomOffsetClass}`}
          onTouchStart={handlePullStart}
          onTouchMove={handlePullMove}
          onTouchEnd={handlePullEnd}
        >
          {(pullDistance > 0 || isPullRefreshing) && (
            <div className="pointer-events-none sticky top-0 z-[70] flex h-0 justify-center">
              <div
                className="mt-3 flex h-10 min-w-10 items-center justify-center rounded-full bg-white/95 px-3 text-blue-600 shadow-lg ring-1 ring-black/5 backdrop-blur"
                style={{ transform: `translateY(${Math.max(0, pullDistance - 46)}px) scale(${0.82 + pullProgress * 0.18})`, opacity: Math.max(0.45, pullProgress) }}
              >
                <RefreshCw size={18} className={isPullRefreshing ? 'animate-spin' : ''} />
              </div>
            </div>
          )}
          {children}
        </main>
        </DebugIndex>
        {!hideNav && (
          <DebugIndex indexId="1.10"><nav className={`fixed inset-x-0 bottom-0 mx-auto w-full max-w-md bg-white/95 backdrop-blur border-t border-gray-200 flex items-end justify-around px-2 ${tabBarHeightClass} ${tabBarPaddingBottomClass} shrink-0 z-50 overflow-visible`}>
            <NavLink to={tabPaths.orders} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('orders'); }} className={() => `flex flex-col items-center gap-1 pb-1 ${resolveBottomTab(location.pathname) === 'orders' ? 'text-blue-600' : 'text-gray-400'}`}><CarFront size={24} /><span className="text-[10px] font-medium">Заказы</span></NavLink>
            <NavLink to={tabPaths.vendors} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('vendors'); }} className={() => `flex flex-col items-center gap-1 pb-1 ${resolveBottomTab(location.pathname) === 'vendors' ? 'text-blue-600' : 'text-gray-400'}`}><Layers size={22} /><span className="text-[10px] font-medium">Поставщики</span></NavLink>
            {/* Center: New Order FAB */}
            <button
              type="button"
              data-debug-id="1.13"
              onClick={() => { playSound('navigate'); navigate('/new'); }}
              className="flex flex-col items-center gap-0.5 -translate-y-3"
              aria-label="Новый заказ"
            >
              <span className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center shadow-lg border-[3px] border-white">
                <PlusCircle size={26} className="text-white" />
              </span>
              <span className="text-[10px] font-medium text-gray-500">Новый</span>
            </button>
            <NavLink to={tabPaths.leads} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('leads'); }} className={() => `flex flex-col items-center gap-1 pb-1 relative ${resolveBottomTab(location.pathname) === 'leads' ? 'text-blue-600' : 'text-gray-400'}`}>
              <span className="relative"><UserRound size={22} />{leadNavStats.total > 0 && <span className={`absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full text-white text-[8px] font-black flex items-center justify-center ${leadNavStats.unread > 0 ? 'bg-amber-500' : 'bg-blue-500'}`}>{leadNavStats.unread > 0 ? (leadNavStats.unread > 99 ? '99+' : leadNavStats.unread) : leadNavStats.total > 99 ? '99+' : leadNavStats.total}</span>}</span>
              <span className="text-[10px] font-medium">Лиды</span>
            </NavLink>
            <NavLink to={tabPaths.settings} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('settings'); }} className={() => `flex flex-col items-center gap-1 pb-1 ${resolveBottomTab(location.pathname) === 'settings' ? 'text-blue-600' : 'text-gray-400'}`}><Settings size={22} /><span className="text-[10px] font-medium">Настройки</span></NavLink>
          </nav></DebugIndex>
        )}
        <button
          type="button"
          aria-label="Toggle debug indexing"
          data-debug-id="1.99"
          className="absolute top-0 right-0 w-6 h-6 opacity-0"
          onClick={toggle}
        />
      </MobileLayoutContainer>
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
        const keepMountedWhenHidden = ['/orders', '/database', '/leads', '/notifications', '/settings', '/new'].includes(pathname);
        if (!isActive && !keepMountedWhenHidden) return null;
        return (
          <div key={pathname} className={isActive ? 'h-full' : 'hidden'}>
            <Suspense fallback={<RouteFallback />}>
            <Routes location={{ ...location, pathname }}>
              <Route path="/" element={<Navigate to="/orders" replace />} />
              <Route path="/morning" element={<MorningBossScreen />} />
              <Route path="/orders" element={<OrdersScreen />} />
              <Route path="/leads" element={<LeadsScreen />} />
              <Route path="/new" element={<NewOrderScreen />} />
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
              <Route
                path="/settings"
                element={(
                  <DebugRouteBoundary>
                    <SettingsScreen />
                  </DebugRouteBoundary>
                )}
              />
              <Route path="/request" element={<PublicOrderFormScreen />} />
              <Route path="/order-form" element={<PublicOrderFormScreen />} />
              <Route path="/public-order-form" element={<PublicOrderFormScreen />} />
              <Route path="/trust" element={<ClientTrustScreen />} />
              <Route path="/client-trust" element={<ClientTrustScreen />} />
              <Route path="/q/:orderId" element={<HashPublicQuoteRoute />} />
              <Route path="*" element={<NotFoundScreen />} />
            </Routes>
            </Suspense>
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
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSavePulse(false), 760);
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
    <div onKeyDown={handleKeyDown} className="min-h-[100dvh]">
      <div className={`min-h-[100dvh] transition-all duration-500 ${isBooting ? 'opacity-0 scale-[0.985]' : 'opacity-100'}`}>
        <div className={`fixed right-3 top-3 z-[90] pointer-events-none transition-all duration-500 ${savePulse ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/92 text-white shadow-lg shadow-emerald-950/15 ring-1 ring-white/60">
            <Check size={14} strokeWidth={3} />
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

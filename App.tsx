import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import NotFoundScreen from './screens/NotFoundScreen';
import { CarFront, Check, Layers, Package, Plus, RefreshCw, Settings } from 'lucide-react';
import { initNotificationsFromServer } from './notificationCenter';
import { DebugRouteBoundary } from './screens/DebugRouteBoundary';
import { DebugIndex, DebugIndexProvider, useDebugIndex } from './components/DebugIndex';
import { playSound } from './utils/sounds';
import { useStore } from './store';

const DebugLogsScreen = lazy(() => import('./screens/DebugLogsScreen'));
const MorningBossScreen = lazy(() => import('./screens/MorningBossScreen'));
const NewOrderScreen = lazy(() => import('./screens/NewOrderScreen'));
const OrderDetailsScreen = lazy(() => import('./screens/OrderDetailsScreen'));
const PartDetailsScreen = lazy(() => import('./screens/PartDetailsScreen'));
const OrderPartsScreen = lazy(() => import('./screens/OrderPartsScreen'));
const SuppliersScreen = lazy(() => import('./screens/SuppliersScreen'));
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const VariantsScreen = lazy(() => import('./screens/VariantsScreen'));
const ClientTrustScreen = lazy(() => import('./screens/ClientTrustScreen'));
const DEBUG_ROUTES_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEBUG_ROUTES === 'true';

const RouteFallback: React.FC = () => (
  <div className="flex min-h-[60dvh] items-center justify-center p-4 text-xs font-bold uppercase tracking-wide text-slate-400">
    Загрузка...
  </div>
);

type RouteErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

class RouteErrorBoundary extends React.Component<React.PropsWithChildren, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  componentDidCatch(error: unknown): void {
    console.error('[route:error-boundary]', error);
  }

  private recover = () => {
    this.setState({ hasError: false, message: '' });
    window.location.hash = '#/orders';
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-[70dvh] items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl border border-rose-100 bg-white p-5 text-center shadow-sm">
          <h1 className="text-lg font-black text-slate-950">Экран не загрузился</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Приложение поймало ошибку и сохранило навигацию. Можно вернуться к заказам и продолжить работу.
          </p>
          {this.state.message && (
            <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold text-slate-500">
              {this.state.message}
            </p>
          )}
          <button type="button" onClick={this.recover} className="mt-4 h-11 rounded-2xl bg-slate-950 px-4 text-xs font-black uppercase text-white">
            Вернуться к заказам
          </button>
        </div>
      </div>
    );
  }
}

const HashPublicQuoteRoute: React.FC = () => {
  const { orderId = '' } = useParams();
  return <PublicQuoteScreen orderId={orderId} />;
};

type BottomTab = 'orders' | 'vendors' | 'new' | 'variants' | 'settings' | null;

const resolveBottomTab = (pathname: string): BottomTab => {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/new') return 'new';
  if (normalizedPath === '/orders' || normalizedPath.startsWith('/order/')) return 'orders';
  if (normalizedPath.startsWith('/database')) return 'vendors';
  if (normalizedPath.startsWith('/variants')) return 'variants';
  if (normalizedPath.startsWith('/settings')) return 'settings';
  return null;
};

const MobileLayoutContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-[100dvh] w-full bg-slate-100">
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-[#f6f8fb] shadow-sm">
      {children}
    </div>
  </div>
);

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toggle } = useDebugIndex();
  const location = useLocation();
  const navigate = useNavigate();
  const { fetchOrders, fetchOrderDetails } = useStore();
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const prevPathname = useRef(location.pathname);
  const pullStartYRef = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);

  const isOrderWorkspace = /^\/order\/[^/]+(?:\/parts|\/part\/[^/]+)?$/.test(location.pathname.replace(/\/+$/, ''));
  const normalizedCurrentPath = location.pathname.replace(/\/+$/, '') || '/';
  const hideNav = resolveBottomTab(location.pathname) === null || isOrderWorkspace;
  const showOrdersCreateButton = normalizedCurrentPath === '/orders';

  const [tabPaths, setTabPaths] = useState<Record<Exclude<BottomTab, null>, string>>({
    orders: '/orders',
    vendors: '/database',
    new: '/new',
    variants: '/variants',
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
      new: '/new',
      variants: '/variants',
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

  const tabBarHeightClass = 'h-[calc(58px+env(safe-area-inset-bottom))]';
  const tabBarBottomOffsetClass = 'pb-[calc(100px+env(safe-area-inset-bottom))]';
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
          <>
          {showOrdersCreateButton && (
            <div className="pointer-events-none fixed bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-50 w-[calc(100%-24px)] max-w-[408px] -translate-x-1/2">
              <div className="flex justify-end pr-2">
                <button
                  type="button"
                  onClick={() => { playSound('navigate'); navigate('/new'); }}
                  className="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_16px_34px_rgba(37,99,235,0.34)] ring-4 ring-white/85 transition active:scale-[0.96]"
                  aria-label="Новый заказ"
                >
                  <Plus size={24} strokeWidth={2.8} />
                </button>
              </div>
            </div>
          )}
          <DebugIndex indexId="1.10"><nav className={`fixed bottom-3 left-1/2 z-50 mx-auto grid w-[calc(100%-24px)] max-w-[408px] -translate-x-1/2 grid-cols-5 items-center gap-1 overflow-hidden rounded-[26px] border border-white/80 bg-white/84 px-2 pt-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.14)] ring-1 ring-slate-900/[0.03] backdrop-blur-xl ${tabBarHeightClass} ${tabBarPaddingBottomClass} shrink-0`}>
            <NavLink aria-label="Заказы" title="Заказы" to={tabPaths.orders} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('orders'); }} className={() => `flex h-11 min-w-0 items-center justify-center rounded-[18px] px-1 transition active:scale-[0.97] ${resolveBottomTab(location.pathname) === 'orders' ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]' : 'text-slate-400'}`}><CarFront size={22} /></NavLink>
            <NavLink aria-label="Поставщики" title="Поставщики" to={tabPaths.vendors} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('vendors'); }} className={() => `flex h-11 min-w-0 items-center justify-center rounded-[18px] px-1 transition active:scale-[0.97] ${resolveBottomTab(location.pathname) === 'vendors' ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]' : 'text-slate-400'}`}><Layers size={22} /></NavLink>
            <NavLink aria-label="Новый" title="Новый" to={tabPaths.new} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('new'); }} className={() => `flex h-11 min-w-0 items-center justify-center rounded-[18px] px-1 text-slate-400 transition active:scale-[0.97]`}><Plus size={23} /></NavLink>
            <NavLink aria-label="Варианты" title="Варианты" to={tabPaths.variants} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('variants'); }} className={() => `flex h-11 min-w-0 items-center justify-center rounded-[18px] px-1 transition active:scale-[0.97] ${resolveBottomTab(location.pathname) === 'variants' ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]' : 'text-slate-400'}`}><Package size={22} /></NavLink>
            <NavLink aria-label="Настройки" title="Настройки" to={tabPaths.settings} onClick={(event) => { event.preventDefault(); playSound('navigate'); handleTabNavigate('settings'); }} className={() => `flex h-11 min-w-0 items-center justify-center rounded-[18px] px-1 transition active:scale-[0.97] ${resolveBottomTab(location.pathname) === 'settings' ? 'bg-blue-50 text-blue-600 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.08)]' : 'text-slate-400'}`}><Settings size={22} /></NavLink>
          </nav></DebugIndex>
          </>
        )}
        <button
          type="button"
          aria-label="Toggle debug indexing"
          data-debug-id="1.99"
          data-allow-small-target="true"
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
        const keepMountedWhenHidden = ['/orders', '/database', '/variants', '/notifications', '/settings', '/new'].includes(pathname);
        if (!isActive && !keepMountedWhenHidden) return null;
        return (
          <div key={pathname} className={isActive ? 'h-full' : 'hidden'}>
            <RouteErrorBoundary>
            <Suspense fallback={<RouteFallback />}>
            <Routes location={{ ...location, pathname }}>
              <Route path="/" element={<Navigate to="/orders" replace />} />
              <Route path="/morning" element={<MorningBossScreen />} />
              <Route path="/orders" element={<OrdersScreen />} />
              <Route path="/leads" element={<Navigate to="/variants" replace />} />
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
                  DEBUG_ROUTES_ENABLED ? (
                    <DebugRouteBoundary>
                      <Suspense fallback={<div className="p-4 text-xs text-gray-500">Загрузка диагностики...</div>}>
                        <DebugLogsScreen />
                      </Suspense>
                    </DebugRouteBoundary>
                  ) : <NotFoundScreen />
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
              <Route path="/tracking/:orderId" element={<HashPublicQuoteRoute />} />
              <Route path="*" element={<NotFoundScreen />} />
            </Routes>
            </Suspense>
            </RouteErrorBoundary>
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

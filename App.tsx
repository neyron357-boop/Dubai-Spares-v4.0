import {
  Bell,
  Boxes,
  CarFront,
  Check,
  CircleAlert,
  HardDrive,
  Layers,
  LayoutDashboard,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import React, { Suspense, lazy, useEffect, useLayoutEffect, useState } from 'react';
import {
  HashRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  useParams,
} from 'react-router-dom';
import AppErrorBoundary from './components/AppErrorBoundary';
import { LoadingState } from './components/ui';
import NotFoundScreen from './screens/NotFoundScreen';
import OrdersScreen from './screens/OrdersScreen';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';

const NewOrderScreen = lazy(() => import('./screens/NewOrderScreen'));
const OrderDetailsScreen = lazy(() => import('./screens/OrderDetailsScreen'));
const PartDetailsScreen = lazy(() => import('./screens/PartDetailsScreen'));
const OrderPartsScreen = lazy(() => import('./screens/OrderPartsScreen'));
const SuppliersScreen = lazy(() => import('./screens/SuppliersScreen'));
const NotificationsScreen = lazy(() => import('./screens/NotificationsScreen'));
const SettingsScreen = lazy(() => import('./screens/SettingsScreen'));
const VariantsScreen = lazy(() => import('./screens/VariantsScreen'));
const ClientTrustScreen = lazy(() => import('./screens/ClientTrustScreen'));
const MorningBossScreen = lazy(() => import('./screens/MorningBossScreen'));
const RadarSessionScreen = lazy(() => import('./screens/RadarSessionScreen'));
const tabs = [
  { path: '/orders', label: 'Заказы', icon: CarFront },
  { path: '/database', label: 'Поставщики', icon: Layers },
  { path: '/new', label: 'Новый', icon: Plus },
  { path: '/variants', label: 'Варианты', icon: Boxes },
  { path: '/settings', label: 'Настройки', icon: Settings },
];
const isPublicPath = (path: string) =>
  /^\/(?:request|order-form|public-order-form|trust|client-trust)(?:\/|$)/.test(path) ||
  /^\/(?:q|tracking)\//.test(path);
function QuoteRoute() {
  const { orderId = '' } = useParams();
  return <PublicQuoteScreen orderId={orderId} />;
}
const routeScrollPositions = new Map<string, number>();
function Layout({ children }: React.PropsWithChildren) {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [saved, setSaved] = useState(false);
  useLayoutEffect(() => {
    const key = location.pathname;
    const explicitTop = (location.state as { restoreScrollTop?: number } | null)?.restoreScrollTop;
    const top =
      typeof explicitTop === 'number'
        ? explicitTop
        : navigationType === 'POP'
          ? routeScrollPositions.get(key) || 0
          : 0;
    window.scrollTo({ top, behavior: 'instant' });
    document.getElementById('main-content')?.focus({ preventScroll: true });
    return () => {
      routeScrollPositions.set(key, window.scrollY);
    };
  }, [location.pathname, location.state, navigationType]);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const onSave = () => {
      setSaved(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setSaved(false), 2200);
    };
    window.addEventListener('local-save-success', onSave);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('local-save-success', onSave);
    };
  }, []);
  const nav = (mobile = false) =>
    tabs.map(({ path, label, icon: Icon }) => {
      const active =
        path === '/orders'
          ? location.pathname === '/orders' || location.pathname.startsWith('/order/')
          : location.pathname.startsWith(path);
      return (
        <NavLink
          key={path}
          to={path}
          aria-current={active ? 'page' : undefined}
          className={`app-nav-item ${active ? 'is-active' : ''} ${path === '/new' ? 'app-nav-create' : ''}`}
        >
          <Icon size={mobile ? 21 : 20} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      );
    });
  return (
    <div
      className={`app-shell ${location.pathname.startsWith('/order/') ? 'app-detail-workspace' : ''}`}
    >
      <a
        href="#main-content"
        className="ui-skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        К содержимому
      </a>
      <aside className="app-sidebar">
        <NavLink to="/orders" className="app-brand">
          <span className="app-brand-icon">
            <CarFront size={25} strokeWidth={1.6} />
          </span>
          <span>
            STARK<span className="app-brand-caption">MOTORS · WORKSPACE</span>
          </span>
        </NavLink>
        <p className="app-nav-caption">Рабочее пространство</p>
        <nav aria-label="Основная навигация">{nav()}</nav>
        <NavLink to="/notifications" className="app-nav-item app-nav-notifications">
          <Bell size={20} />
          <span>Уведомления</span>
        </NavLink>
        <NavLink to="/morning" className="app-nav-item">
          <LayoutDashboard size={20} />
          <span>Обзор</span>
        </NavLink>
        <div className="app-local-note">
          <HardDrive size={20} />
          <div>
            <strong>Локальный режим</strong>
            <p>Данные на этом устройстве</p>
          </div>
          <i />
        </div>
      </aside>
      <div className="app-workspace">
        <div className="app-topbar">
          <span className="app-mobile-brand">
            STARK <b>MOTORS</b>
          </span>
          <span className={`app-save-state ${saved ? 'is-saved' : ''}`} role="status">
            {saved ? <Check size={15} /> : <HardDrive size={15} />}
            {saved ? 'Сохранено' : 'На устройстве'}
          </span>
          {location.pathname !== '/orders' && (
            <NavLink to="/notifications" aria-label="Уведомления" className="ui-icon-button">
              <Bell size={20} />
            </NavLink>
          )}
        </div>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav className="app-bottom-nav" aria-label="Мобильная навигация">
        {nav(true)}
      </nav>
    </div>
  );
}
function PrivateRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/orders" replace />} />
      <Route path="/orders" element={<OrdersScreen />} />
      <Route path="/new" element={<NewOrderScreen />} />
      <Route path="/order/:id" element={<OrderDetailsScreen />} />
      <Route path="/order/:orderId/parts" element={<OrderPartsScreen />} />
      <Route path="/order/:orderId/part/:partId" element={<PartDetailsScreen />} />
      <Route path="/database" element={<SuppliersScreen />} />
      <Route path="/variants" element={<VariantsScreen />} />
      <Route path="/leads" element={<Navigate to="/orders" replace />} />
      <Route path="/notifications" element={<NotificationsScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/morning" element={<MorningBossScreen />} />
      <Route path="/radar/session/:sessionId" element={<RadarSessionScreen />} />
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}
function RoutedApp() {
  const location = useLocation(),
    isPublic = isPublicPath(location.pathname);
  const [toast, setToast] = useState<{
    message: string;
    tone: 'error' | 'success' | 'info';
  } | null>(null);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const show = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.message) return;
      setToast({ message: detail.message, tone: detail.tone || 'info' });
      clearTimeout(timeout);
      timeout = setTimeout(() => setToast(null), detail.tone === 'error' ? 7000 : 4000);
    };
    window.addEventListener('app-toast', show);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('app-toast', show);
    };
  }, []);
  return (
    <>
      <AppErrorBoundary key={isPublic ? 'public' : 'private'}>
        <Suspense fallback={<LoadingState />}>
          {isPublic ? (
            <div className="public-workspace">
              <Routes>
                <Route path="/request" element={<PublicOrderFormScreen />} />
                <Route path="/order-form" element={<PublicOrderFormScreen />} />
                <Route path="/public-order-form" element={<PublicOrderFormScreen />} />
                <Route path="/trust" element={<ClientTrustScreen />} />
                <Route path="/client-trust" element={<ClientTrustScreen />} />
                <Route path="/q/:orderId" element={<QuoteRoute />} />
                <Route path="/tracking/:orderId" element={<QuoteRoute />} />
              </Routes>
            </div>
          ) : (
            <Layout>
              <PrivateRoutes />
            </Layout>
          )}
        </Suspense>
      </AppErrorBoundary>
      {!isPublic && toast && (
        <div
          className={`ui-toast ui-toast-${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          {toast.tone === 'error' ? <CircleAlert size={20} /> : <Check size={20} />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Закрыть уведомление">
            <X size={18} />
          </button>
        </div>
      )}
    </>
  );
}
export default function App() {
  return (
    <HashRouter>
      <RoutedApp />
    </HashRouter>
  );
}

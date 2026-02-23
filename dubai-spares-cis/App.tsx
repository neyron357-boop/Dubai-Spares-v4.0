import React, { Suspense, lazy, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, useLocation, useParams } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import RadarScreen from './screens/RadarScreen';
import SettingsScreen from './screens/SettingsScreen';
import RadarLiveSettingsScreen from './screens/RadarLiveSettingsScreen';
import PublicOrderFormScreen from './screens/PublicOrderFormScreen';
import PublicQuoteScreen from './screens/PublicQuoteScreen';
import NotFoundScreen from './screens/NotFoundScreen';
import VendorSlider from './components/VendorSlider';
import { CarFront, PlusCircle, Database, Bell, Radar, Settings } from 'lucide-react';
import { getUnreadNotificationsCount } from './notificationCenter';
import { LOCAL_MODE_LABEL } from './localMode';
import { DebugRouteBoundary } from './screens/DebugRouteBoundary';
import { playSound } from './utils/sounds';

const DebugLogsScreen = lazy(() => import('./screens/DebugLogsScreen'));

const HashPublicQuoteRoute: React.FC = () => {
  const { orderId = '' } = useParams();
  return <PublicQuoteScreen orderId={orderId} />;
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const hideNav = location.pathname.includes('/estimate')
    || location.pathname.includes('/vendor')
    || location.pathname.includes('/request')
    || location.pathname.includes('/order-form')
    || location.pathname.includes('/public-order-form');
  const [unreadCount, setUnreadCount] = useState(() => getUnreadNotificationsCount());

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

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div className="fixed inset-0 h-[100dvh] w-full bg-slate-100 flex justify-center overflow-hidden"><div className="h-full w-full max-w-md bg-gray-50 flex flex-col overflow-hidden shadow-sm">
      <main className="flex-1 overflow-y-auto no-scrollbar relative">
        <div className="fixed top-3 right-3 z-[90] px-2.5 py-1 rounded-full bg-slate-700/85 text-white text-[10px] font-black uppercase tracking-wide shadow">
          {LOCAL_MODE_LABEL}
        </div>
        {children}
      </main>
      {!hideNav && (
        <nav className="h-16 bg-white border-t border-gray-200 flex items-center justify-around px-2 pb-safe shrink-0 z-50">
          <NavLink to="/" onClick={() => playSound('navigate')} className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><CarFront size={24} /><span className="text-[10px] font-medium">Заказы</span></NavLink>
          <NavLink to="/new" onClick={() => playSound('navigate')} className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><PlusCircle size={24} /><span className="text-[10px] font-medium">Новый</span></NavLink>
          <NavLink to="/database" onClick={() => playSound('navigate')} className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Database size={22} /><span className="text-[10px] font-medium">База</span></NavLink>
          <NavLink to="/radar" onClick={() => playSound('navigate')} className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Radar size={22} /><span className="text-[10px] font-medium">Радар</span></NavLink>
          <NavLink to="/notifications" onClick={() => playSound('navigate')} className={({ isActive }) => `relative flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Bell size={21} />
            {unreadCount > 0 && <span className="absolute -top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">{badgeLabel}</span>}
            <span className="text-[10px] font-medium">Оповещ.</span>
          </NavLink>
          <NavLink to="/settings" onClick={() => playSound('navigate')} className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Settings size={22} /><span className="text-[10px] font-medium">Настр.</span></NavLink>
        </nav>
      )}
      </div>
    </div>
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
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
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
      <div className={`transition-all duration-500 ${isBooting ? 'opacity-0 scale-[0.985]' : 'opacity-100 scale-100'}`}>
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
            <Routes>
              <Route path="/" element={<OrdersScreen />} />
              <Route path="/new" element={<NewOrderScreen />} />
              <Route path="/vendor" element={<VendorSlider />} />
              <Route path="/order/:id" element={<OrderDetailsScreen />} />
              <Route path="/order/:orderId/part/:partId" element={<PartDetailsScreen />} />
              <Route path="/database" element={<SuppliersScreen />} />
              <Route path="/radar" element={<RadarScreen />} />
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
              <Route path="/settings/radar-live" element={<RadarLiveSettingsScreen />} />
              <Route path="/request" element={<PublicOrderFormScreen />} />
              <Route path="/order-form" element={<PublicOrderFormScreen />} />
              <Route path="/public-order-form" element={<PublicOrderFormScreen />} />
              <Route path="/q/:orderId" element={<HashPublicQuoteRoute />} />
              <Route path="*" element={<NotFoundScreen />} />
            </Routes>
          </Layout>
        </HashRouter>
      </div>
    </div>
  );
};

export default App;

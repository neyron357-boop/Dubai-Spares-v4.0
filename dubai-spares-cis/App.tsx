import React, { Suspense, lazy, useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import RadarScreen from './screens/RadarScreen';
import SettingsScreen from './screens/SettingsScreen';
import RadarLiveSettingsScreen from './screens/RadarLiveSettingsScreen';
import VendorSlider from './components/VendorSlider';
import { CarFront, PlusCircle, Database, Bell, Radar, Settings } from 'lucide-react';
import { useStore } from './store';
import { getUnreadNotificationsCount } from './notificationCenter';
import { LOCAL_MODE_LABEL } from './localMode';
import { DebugRouteBoundary } from './screens/DebugRouteBoundary';

const DebugLogsScreen = lazy(() => import('./screens/DebugLogsScreen'));

const Layout: React.FC<{ children: React.ReactNode; isSyncing: boolean }> = ({ children, isSyncing }) => {
  const location = useLocation();
  const hideNav = location.pathname.includes('/estimate') || location.pathname.includes('/vendor');
  const [unreadCount, setUnreadCount] = useState(() => getUnreadNotificationsCount());

  useEffect(() => {
    const updateUnread = () => setUnreadCount(getUnreadNotificationsCount());
    window.addEventListener('notifications:changed', updateUnread);
    return () => window.removeEventListener('notifications:changed', updateUnread);
  }, []);

  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <div className="fixed inset-0 h-[100dvh] w-full max-w-md mx-auto bg-gray-50 flex flex-col overflow-hidden">
      <div className="h-0.5 bg-transparent">
        <div className={`h-full bg-blue-500 transition-all duration-300 ${isSyncing ? 'w-full opacity-100 animate-pulse' : 'w-0 opacity-0'}`} />
      </div>
      <main className="flex-1 overflow-y-auto no-scrollbar relative">
        <div className="fixed top-3 right-3 z-[90] px-2.5 py-1 rounded-full bg-slate-700/85 text-white text-[10px] font-black uppercase tracking-wide shadow">{LOCAL_MODE_LABEL}</div>
        {children}
      </main>
      {!hideNav && (
        <nav className="h-16 bg-white border-t border-gray-200 flex items-center justify-around px-2 pb-safe shrink-0 z-50">
          <NavLink to="/" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><CarFront size={24} /><span className="text-[10px] font-medium">Заказы</span></NavLink>
          <NavLink to="/new" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><PlusCircle size={24} /><span className="text-[10px] font-medium">Новый</span></NavLink>
          <NavLink to="/database" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Database size={22} /><span className="text-[10px] font-medium">База</span></NavLink>
          <NavLink to="/radar" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Radar size={22} /><span className="text-[10px] font-medium">Радар</span></NavLink>
          <NavLink to="/notifications" className={({ isActive }) => `relative flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Bell size={21} />{unreadCount > 0 && <span className="absolute -top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">{badgeLabel}</span>}<span className="text-[10px] font-medium">Оповещ.</span></NavLink>
          <NavLink to="/settings" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Settings size={22} /><span className="text-[10px] font-medium">Настр.</span></NavLink>
        </nav>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const { isLoading, syncOrders } = useStore();

  useEffect(() => { void syncOrders(); }, [syncOrders]);

  return (
    <HashRouter>
      <Layout isSyncing={isLoading}>
        <Routes>
          <Route path="/" element={<OrdersScreen />} />
          <Route path="/new" element={<NewOrderScreen />} />
          <Route path="/vendor" element={<VendorSlider />} />
          <Route path="/order/:id" element={<OrderDetailsScreen />} />
          <Route path="/order/:orderId/part/:partId" element={<PartDetailsScreen />} />
          <Route path="/database" element={<SuppliersScreen />} />
          <Route path="/radar" element={<RadarScreen />} />
          <Route path="/notifications" element={<NotificationsScreen />} />
          <Route path="/debug" element={<DebugRouteBoundary><Suspense fallback={<div className="p-4 text-xs text-gray-500">Loading debug tools…</div>}><DebugLogsScreen /></Suspense></DebugRouteBoundary>} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/radar-live" element={<RadarLiveSettingsScreen />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
};

export default App;

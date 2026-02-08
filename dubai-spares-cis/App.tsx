import React, { useMemo, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import VendorSlider from './components/VendorSlider';
import { useStore } from './store';

import {
  CarFront,
  PlusCircle,
  Database,
  Lock
} from 'lucide-react';

const APP_PIN = '1234'; // change only in code

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const hideNav = location.pathname.includes('/estimate') || location.pathname.includes('/vendor');

  return (
    <div className="fixed inset-0 h-[100dvh] w-full max-w-md mx-auto bg-gray-50 flex flex-col overflow-hidden">
      <main className="flex-1 overflow-y-auto no-scrollbar relative">
        {children}
      </main>

      {!hideNav && (
        <nav className="h-16 bg-white border-t border-gray-200 flex items-center justify-around px-2 pb-safe shrink-0 z-50">
          <NavLink to="/" className={({ isActive }) => `flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
            <CarFront size={24} />
            <span className="text-[10px] font-medium">Заказы</span>
          </NavLink>
          <NavLink to="/new" className={({ isActive }) => `flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
            <PlusCircle size={24} />
            <span className="text-[10px] font-medium">Новый</span>
          </NavLink>
          <NavLink to="/database" className={({ isActive }) => `flex flex-col items-center gap-1 transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
            <Database size={24} />
            <span className="text-[10px] font-medium">База</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
};

const PinGate: React.FC<{ onUnlock: () => void }> = ({ onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const canSubmit = useMemo(() => pin.length === 4, [pin]);

  const submit = () => {
    if (pin === APP_PIN) {
      setError('');
      onUnlock();
      return;
    }
    setError('Неверный PIN');
    setPin('');
  };

  return (
    <div className="fixed inset-0 z-[120] bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-xs bg-gray-900 border border-gray-800 rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2 justify-center text-blue-400"><Lock size={18} /> <span className="text-xs uppercase tracking-[0.2em] font-black">Protected</span></div>
        <h2 className="text-center text-2xl font-black">Введите PIN</h2>
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full text-center tracking-[0.4em] text-3xl font-black bg-gray-800 border border-gray-700 rounded-2xl p-3 outline-none"
          placeholder="••••"
        />
        {error && <p className="text-center text-red-400 text-xs font-bold">{error}</p>}
        <button onClick={submit} disabled={!canSubmit} className="w-full py-3 rounded-2xl bg-blue-600 font-black disabled:opacity-40">Открыть</button>
      </div>
    </div>
  );
};

const AppContent: React.FC = () => {
  const { isHydrated } = useStore();
  const [unlocked, setUnlocked] = useState(false);

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

  return (
    <div onKeyDown={handleKeyDown}>
      {!isHydrated && (
        <div className="fixed inset-0 z-[110] bg-gray-950 text-white flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-xs font-black uppercase tracking-[0.2em]">Загрузка данных...</p>
        </div>
      )}

      {!unlocked && isHydrated && <PinGate onUnlock={() => setUnlocked(true)} />}

      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<OrdersScreen />} />
            <Route path="/new" element={<NewOrderScreen />} />
            <Route path="/vendor" element={<VendorSlider />} />
            <Route path="/order/:id" element={<OrderDetailsScreen />} />
            <Route path="/order/:orderId/part/:partId" element={<PartDetailsScreen />} />
            <Route path="/database" element={<SuppliersScreen />} />
          </Routes>
        </Layout>
      </HashRouter>
    </div>
  );
};

export default AppContent;

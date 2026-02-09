import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import VendorSlider from './components/VendorSlider';
import { CarFront, PlusCircle, Database } from 'lucide-react';
import { useStore } from './store';

const APP_PIN = '2202';

const PinGate: React.FC<{ onUnlock: () => void; isEntering: boolean }> = ({ onUnlock, isEntering }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const submit = () => {
    if (value === APP_PIN) onUnlock();
    else {
      setError(true);
      setValue('');
    }
  };

  return (
    <div className={`fixed inset-0 h-[100dvh] w-full max-w-md mx-auto bg-gray-950 flex flex-col items-center justify-center p-6 text-white transition-opacity duration-500 ${isEntering ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      <h1 className="text-xl font-black mb-2">Введите PIN</h1>
      <p className="text-xs text-gray-400 mb-4">Простой код доступа к приложению</p>
      <input
        autoFocus
        type="password"
        maxLength={4}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          setError(false);
          setValue(e.target.value.replace(/\D/g, ''));
        }}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        className="w-full max-w-[220px] text-center text-3xl tracking-[0.6em] font-black bg-gray-900 border border-gray-700 rounded-2xl p-4 outline-none"
      />
      <button type="button" onClick={submit} className="mt-4 px-6 py-3 bg-blue-600 rounded-xl text-sm font-black uppercase tracking-wide">Открыть</button>
      {error && <p className="text-red-400 text-xs mt-2">Неверный PIN</p>}
    </div>
  );
};

const Layout: React.FC<{ children: React.ReactNode; isSyncing: boolean; isOffline: boolean }> = ({ children, isSyncing, isOffline }) => {
  const location = useLocation();
  const hideNav = location.pathname.includes('/estimate') || location.pathname.includes('/vendor');

  return (
    <div className="fixed inset-0 h-[100dvh] w-full max-w-md mx-auto bg-gray-50 flex flex-col overflow-hidden">
      <div className="h-0.5 bg-transparent">
        <div className={`h-full bg-blue-500 transition-all duration-300 ${isSyncing ? 'w-full opacity-100 animate-pulse' : 'w-0 opacity-0'}`} />
      </div>
      <main className="flex-1 overflow-y-auto no-scrollbar relative">
        {isOffline && (
          <div className="fixed top-3 left-3 z-[90] px-2.5 py-1 rounded-full bg-amber-500 text-white text-[10px] font-black uppercase tracking-wide shadow">
            Offline Mode
          </div>
        )}
        {children}
      </main>
      {!hideNav && (
        <nav className="h-16 bg-white border-t border-gray-200 flex items-center justify-around px-2 pb-safe shrink-0 z-50">
          <NavLink to="/" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><CarFront size={24} /><span className="text-[10px] font-medium">Заказы</span></NavLink>
          <NavLink to="/new" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><PlusCircle size={24} /><span className="text-[10px] font-medium">Новый</span></NavLink>
          <NavLink to="/database" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Database size={24} /><span className="text-[10px] font-medium">База</span></NavLink>
        </nav>
      )}
    </div>
  );
};

const App: React.FC = () => {
  const [unlocked, setUnlocked] = useState(false);
  const [entering, setEntering] = useState(false);
  const [savePulse, setSavePulse] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const { syncOrders, isLoading, error } = useStore();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onSave = () => {
      setSavePulse(true);
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
    if (!error) return;
    setSyncToast('Offline mode / Sync error');
    const t = setTimeout(() => setSyncToast(null), 2800);
    return () => clearTimeout(t);
  }, [error]);


  useEffect(() => {
    const onStatus = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', onStatus);
    window.addEventListener('offline', onStatus);
    return () => {
      window.removeEventListener('online', onStatus);
      window.removeEventListener('offline', onStatus);
    };
  }, []);
  const onUnlock = () => {
    setEntering(true);
    void syncOrders();
    setTimeout(() => setUnlocked(true), 140);
  };

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
      <PinGate onUnlock={onUnlock} isEntering={entering || unlocked} />

      <div className={`transition-opacity duration-500 ${unlocked ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className={`fixed top-3 right-3 z-[90] pointer-events-none transition-all duration-700 ${savePulse ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
          <div className="px-2.5 py-1 rounded-full bg-emerald-500/90 text-white text-[10px] font-black uppercase tracking-wider shadow-lg">
            Сохранено
          </div>
        </div>

        {syncToast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[95] px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wide shadow">
            {syncToast}
          </div>
        )}

        <HashRouter>
          <Layout isSyncing={isLoading} isOffline={isOffline}>
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
    </div>
  );
};

export default App;

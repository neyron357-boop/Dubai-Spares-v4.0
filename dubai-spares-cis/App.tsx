import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import DebugLogsScreen from './screens/DebugLogsScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import RadarScreen from './screens/RadarScreen';
import SettingsScreen from './screens/SettingsScreen';
import RadarLiveSettingsScreen from './screens/RadarLiveSettingsScreen';
import VendorSlider from './components/VendorSlider';
import { CarFront, PlusCircle, Database, Bell, Radar, Settings } from 'lucide-react';
import { useStore } from './store';
import { NotificationType, getUnreadNotificationsCount, pushNotification } from './notificationCenter';
import { checkSchemaHealth } from './schemaHealth';
import { loadAppSettings, saveAppSettings } from './appSettings';

const APP_PIN = '2202';

const PinGate: React.FC<{ onUnlock: () => void; isEntering: boolean }> = ({ onUnlock, isEntering }) => {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const onDigit = (digit: string) => {
    if (value.length >= 4) return;
    const next = `${value}${digit}`;
    setError(false);
    setValue(next);
    if (next.length === 4) {
      setTimeout(() => {
        if (next === APP_PIN) onUnlock();
        else {
          setError(true);
          setValue('');
        }
      }, 120);
    }
  };

  const deleteDigit = () => {
    setError(false);
    setValue((prev) => prev.slice(0, -1));
  };

  const submit = () => {
    if (value === APP_PIN) onUnlock();
    else {
      setError(true);
      setValue('');
    }
  };

  return (
    <div className={`fixed inset-0 h-[100dvh] w-full max-w-md mx-auto bg-slate-950 flex flex-col items-center justify-between p-6 pt-14 text-white transition-opacity duration-500 ${isEntering ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      <style>{`@keyframes pin-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
      <div className="text-center">
        <div className="inline-flex h-12 items-center rounded-2xl border border-slate-800 px-4 text-sm font-black tracking-[0.18em] text-slate-200">DUBAI SPARES</div>
        <h1 className="text-2xl font-black mt-5">Field Mode</h1>
        <p className="text-sm text-slate-400 mt-1">Введите PIN для быстрого входа</p>
      </div>

      <div className="w-full max-w-[280px]">
        <div className={`flex justify-center gap-3 mb-4 ${error ? '[animation:pin-shake_0.25s_linear_2]' : ''}`}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className={`h-4 w-4 rounded-full border ${value.length > idx ? 'bg-blue-500 border-blue-400' : 'border-slate-600 bg-slate-900'}`} />
          ))}
        </div>
        {error && <p className="text-rose-400 text-xs font-bold text-center mb-4">Неверный PIN. Попробуйте ещё раз.</p>}
        <div className="grid grid-cols-3 gap-3">
          {[...'123456789'].map((digit) => (
            <button key={digit} type="button" onClick={() => onDigit(digit)} className="h-12 rounded-2xl bg-slate-900 border border-slate-700 text-lg font-black">{digit}</button>
          ))}
          <button type="button" className="h-12 rounded-2xl bg-slate-900 border border-slate-700 text-xs font-black">Face ID</button>
          <button type="button" onClick={() => onDigit('0')} className="h-12 rounded-2xl bg-slate-900 border border-slate-700 text-lg font-black">0</button>
          <button type="button" onClick={deleteDigit} className="h-12 rounded-2xl bg-slate-900 border border-slate-700 text-xs font-black">⌫</button>
        </div>
        <button type="button" onClick={submit} className="mt-3 w-full h-12 rounded-2xl bg-blue-600 text-sm font-black uppercase tracking-wide">Войти быстрее</button>
      </div>

      <p className="text-[11px] text-slate-500">Личный рабочий инструмент</p>
    </div>
  );
};

const Layout: React.FC<{ children: React.ReactNode; isSyncing: boolean; isOffline: boolean }> = ({ children, isSyncing, isOffline }) => {
  const location = useLocation();
  const hideNav = location.pathname.includes('/estimate') || location.pathname.includes('/vendor');
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
          <NavLink to="/database" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Database size={22} /><span className="text-[10px] font-medium">База</span></NavLink>
          <NavLink to="/radar" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Radar size={22} /><span className="text-[10px] font-medium">Радар</span></NavLink>
          <NavLink to="/notifications" className={({ isActive }) => `relative flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Bell size={21} />
            {unreadCount > 0 && <span className="absolute -top-1 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black flex items-center justify-center">{badgeLabel}</span>}
            <span className="text-[10px] font-medium">Оповещ.</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `flex flex-col items-center gap-1 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}><Settings size={22} /><span className="text-[10px] font-medium">Настр.</span></NavLink>
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
  const [appToast, setAppToast] = useState<{ message: string; tone: 'error' | 'success' | 'info' } | null>(null);
  const [schemaBanner, setSchemaBanner] = useState<string | null>(null);
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
    const onAppToast = (event: Event) => {
      const custom = event as CustomEvent<{ message?: string; tone?: 'error' | 'success' | 'info' }>;
      const message = custom.detail?.message;
      if (!message) return;
      setAppToast({ message, tone: custom.detail?.tone || 'info' });
      window.setTimeout(() => setAppToast(null), 3200);
    };

    window.addEventListener('app-toast', onAppToast);
    return () => window.removeEventListener('app-toast', onAppToast);
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    void checkSchemaHealth().then((status) => {
      const cfg = loadAppSettings();
      if (!status.compatible && Date.now() > cfg.hideSchemaWarningUntil) {
        setSchemaBanner(status.reason || 'Schema mismatch');
      }
    });
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;
    void syncOrders();
  }, [unlocked, syncOrders]);

  useEffect(() => {
    if (!error) return;
    const readable = String(error).toLowerCase().includes('schema') || String(error).toLowerCase().includes('supabase') ? 'Проблема синхронизации данных. Попробуйте ещё раз.' : `Sync error: ${error}`;
    setSyncToast(readable);
    const t = setTimeout(() => setSyncToast(null), 4500);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    const onSyncError = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      const message = customEvent.detail?.message || 'Unknown sync error';
      const readable = message.toLowerCase().includes('schema') || message.toLowerCase().includes('supabase') ? 'Сервис данных временно недоступен. Повторите позже.' : `Sync failed: ${message}`;
      setSyncToast(readable);
      pushNotification({
        type: NotificationType.SYNC_ERROR,
        title: 'Ошибка синхронизации',
        message: readable,
        source: 'sync',
        severity: 'critical'
      });
    };

    window.addEventListener('cloud-sync-error', onSyncError);
    return () => window.removeEventListener('cloud-sync-error', onSyncError);
  }, []);

  useEffect(() => {
    const onStatus = () => {
      const offline = !navigator.onLine;
      setIsOffline(offline);
      if (offline) {
        pushNotification({
          type: NotificationType.OFFLINE_QUEUE,
          title: 'Offline режим',
          message: 'Действия сохраняются в локальную очередь',
          source: 'sync',
          offline: true,
          severity: 'warning'
        });
      } else {
        window.dispatchEvent(new CustomEvent('app-toast', { detail: { message: '✅ Синхронизировано: очередь отправлена', tone: 'success' } }));
      }
    };
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

        {schemaBanner && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[96] max-w-[90%] px-3 py-2 rounded-xl bg-rose-100 text-rose-700 text-[10px] font-black tracking-wide shadow">
            <div>{schemaBanner}</div>
            <button className="underline" type="button" onClick={() => { saveAppSettings({ hideSchemaWarningUntil: Date.now() + 24 * 60 * 60 * 1000 }); setSchemaBanner(null); }}>Не показывать 24ч</button>
          </div>
        )}

        {syncToast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[95] px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-black uppercase tracking-wide shadow">
            {syncToast}
          </div>
        )}

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
          <Layout isSyncing={isLoading} isOffline={isOffline}>
            <Routes>
              <Route path="/" element={<OrdersScreen />} />
              <Route path="/new" element={<NewOrderScreen />} />
              <Route path="/vendor" element={<VendorSlider />} />
              <Route path="/order/:id" element={<OrderDetailsScreen />} />
              <Route path="/order/:orderId/part/:partId" element={<PartDetailsScreen />} />
              <Route path="/database" element={<SuppliersScreen />} />
              <Route path="/radar" element={<RadarScreen />} />
              <Route path="/notifications" element={<NotificationsScreen />} />
              <Route path="/debug" element={<DebugLogsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/settings/radar-live" element={<RadarLiveSettingsScreen />} />
            </Routes>
          </Layout>
        </HashRouter>
      </div>
    </div>
  );
};

export default App;

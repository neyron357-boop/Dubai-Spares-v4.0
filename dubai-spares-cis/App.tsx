import React from 'react';
import { HashRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import OrdersScreen from './screens/OrdersScreen';
import NewOrderScreen from './screens/NewOrderScreen';
import OrderDetailsScreen from './screens/OrderDetailsScreen';
import PartDetailsScreen from './screens/PartDetailsScreen';
import SuppliersScreen from './screens/SuppliersScreen';
import VendorSlider from './components/VendorSlider';

import { 
  CarFront, 
  PlusCircle, 
  Database,
  ChevronRight
} from 'lucide-react';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const hideNav = location.pathname.includes('/estimate') || location.pathname.includes('/vendor');

  return (
    // REVERTED: Back to h-[100dvh] which handled the viewport resizing better in the previous version.
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

const App: React.FC = () => {
  // Global Enter Key Handler for next field
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const target = e.target as HTMLInputElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') {
        e.preventDefault();
        const form = target.form;
        if (form) {
          const index = Array.prototype.indexOf.call(form, target);
          const next = form.elements[index + 1] as HTMLElement;
          if (next) {
            // preventScroll: true helps, but the main fix is in CSS font-size
            next.focus({ preventScroll: true });
          } else {
            target.blur();
          }
        }
      }
    }
  };

  return (
    <div onKeyDown={handleKeyDown}>
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

export default App;

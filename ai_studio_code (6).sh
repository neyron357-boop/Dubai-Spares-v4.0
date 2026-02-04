#!/usr/bin/env bash
set -euo pipefail

# Project directory
PROJECT_NAME="dubai-spares-cis"

echo "Creating project: $PROJECT_NAME"
mkdir -p "$PROJECT_NAME"
cd "$PROJECT_NAME"

# Create directories
mkdir -p components screens

# --- Configuration Files ---

echo "Generating package.json..."
cat > package.json <<'EOF'
{
  "name": "dubai-spares-cis",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^0.454.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "typescript": "^5.5.3",
    "vite": "^5.4.1"
  }
}
EOF

echo "Generating tsconfig.json..."
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
EOF

echo "Generating vite.config.ts..."
cat > vite.config.ts <<'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
})
EOF

# --- Source Files ---

echo "Creating metadata.json..."
cat > metadata.json <<'EOF'
{
  "name": "Dubai Spares CIS Ops",
  "description": "A high-performance personal CRM for auto parts procurement, optimized for field work in Dubai with zero-zoom UX and intelligent data persistence.",
  "requestFramePermissions": [
    "camera",
    "geolocation"
  ]
}
EOF

echo "Creating index.html..."
cat > index.html <<'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <!-- 
      RELAXED VIEWPORT:
      Removed user-scalable=no to allow manual pinch-zoom.
      Kept viewport-fit=cover for notch handling.
    -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Dubai Spares CIS</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        /* Base reset */
        * {
            -webkit-tap-highlight-color: transparent;
            box-sizing: border-box;
        }

        /* 
           STABILITY LOCKS:
           1. position: fixed + inset: 0 keeps the app "shell" stable.
           2. overflow-x: hidden prevents horizontal shift when keyboard pushes layout.
           3. REMOVED touch-action: none to allow user zooming/panning.
        */
        html, body {
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            overflow: hidden; 
            overflow-x: hidden; /* Critical to stop keyboard wobble */
            background-color: #f9fafb;
            -webkit-text-size-adjust: 100%;
            text-size-adjust: 100%;
        }

        #root {
            width: 100%;
            height: 100%;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        body {
            user-select: none;
            -webkit-user-select: none;
        }

        .no-scrollbar::-webkit-scrollbar {
            display: none;
        }
        .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
        }

        /* 
           INPUT STABILIZATION (The only zoom restriction):
           font-size: 17px prevents iOS from AUTO-zooming when focusing an input.
           This allows manual zoom elsewhere, but keeps the keyboard stable.
        */
        input, select, textarea {
            font-size: 17px !important;
            max-width: 100%;
            border-radius: 0;
            touch-action: manipulation;
        }

        /* Preserve larger text for specific inputs */
        input.text-4xl { font-size: 2.25rem !important; }
        input.text-3xl { font-size: 1.875rem !important; }
        input.text-2xl { font-size: 1.5rem !important; }
        input.text-xl { font-size: 1.25rem !important; }
        input.text-lg { font-size: 1.125rem !important; }

        input:focus, select:focus, textarea:focus {
            outline: none;
        }
        
        main {
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
        }
    </style>
    <script type="importmap">
    {
      "imports": {
        "react-dom/": "https://esm.sh/react-dom@^19.2.4/",
        "react": "https://esm.sh/react@^19.2.4",
        "react/": "https://esm.sh/react@^19.2.4/",
        "lucide-react": "https://esm.sh/lucide-react@^0.563.0",
        "react-router-dom": "https://esm.sh/react-router-dom@^7.13.0"
      }
    }
    </script>
    <!-- Removed JS gesture blockers to allow pinch-zoom and double-tap zoom -->
</head>
<body class="bg-gray-50 text-gray-900 font-sans">
    <div id="root"></div>
</body>
</html>
EOF

# Inject entry point script for Vite
sed -i '' 's|</body>|<script type="module" src="/index.tsx"></script></body>|' index.html 2>/dev/null || sed -i 's|</body>|<script type="module" src="/index.tsx"></script></body>|' index.html

echo "Creating index.tsx..."
cat > index.tsx <<'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found");

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
EOF

echo "Creating types.ts..."
cat > types.ts <<'EOF'
export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH'
}

export enum Source {
  INSTAGRAM = 'Instagram',
  TIKTOK = 'TikTok',
  FACEBOOK = 'Facebook',
  TELEGRAM = 'Telegram',
  WHATSAPP = 'WhatsApp',
  OTHER = 'Другое'
}

export interface PriceVariant {
  id: string;
  priceAed: number;
  shopName: string;
  phone: string;
  location: string;
  photoUrl?: string; // Deprecated, use photos
  photos?: string[]; // New
  createdAt: number;
}

export interface Part {
  id: string;
  name: string;
  photoUrl?: string; // Deprecated, use photos
  photos?: string[]; // New
  variants: PriceVariant[];
  isFound: boolean;
}

export interface Order {
  id: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  priority: Priority;
  clientName: string;
  source: Source;
  carPhotoUrl?: string; // Deprecated, use carPhotos
  carPhotos?: string[]; // New
  parts: Part[];
  markupPercent: number;
  exchangeRate: number;
  createdAt: number;
  isArchived: boolean;
  isSold: boolean;
  soldProfitUsd?: number; 
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  location: string;
  brands: string[];
  photoUrl?: string;
  photos?: string[];
}
EOF

echo "Creating constants.ts..."
cat > constants.ts <<'EOF'
import { Source } from './types';

export const BRANDS = [
  'Toyota', 'Lexus', 'Nissan', 'Infiniti', 'Mitsubishi', 'Honda', 'Mazda', 'Subaru',
  'Mercedes-Benz', 'BMW', 'Audi', 'Porsche', 'Volkswagen', 'Land Rover', 'Jaguar',
  'Ford', 'Chevrolet', 'Jeep', 'Dodge', 'Hyundai', 'Kia', 'Tesla'
].sort();

export const SOURCES = Object.values(Source);

export const YEARS = Array.from({ length: 30 }, (_, i) => (new Date().getFullYear() - i).toString());

export const DEFAULT_MARKUP = 15;
export const DEFAULT_RATE = 3.67;
EOF

echo "Creating store.ts..."
cat > store.ts <<'EOF'
import { useState, useEffect, useCallback } from 'react';
import { Order, Supplier } from './types';

const ORDERS_KEY = 'dubai_spares_orders';
const SUPPLIERS_KEY = 'dubai_spares_suppliers';

// Global Memory State (Singleton Pattern)
// This ensures that state updates are immediate and shared across all components 
// without waiting for LocalStorage round-trips or React render cycles.
let globalOrders: Order[] = [];
let globalSuppliers: Supplier[] = [];
let listeners = new Set<() => void>();

// Initialize once on module load
try {
  const savedOrders = localStorage.getItem(ORDERS_KEY);
  if (savedOrders) globalOrders = JSON.parse(savedOrders);

  const savedSuppliers = localStorage.getItem(SUPPLIERS_KEY);
  if (savedSuppliers) globalSuppliers = JSON.parse(savedSuppliers);
} catch (e) {
  console.error('Failed to load initial data:', e);
}

const notifyListeners = () => {
  // Persist to storage
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(globalOrders));
    localStorage.setItem(SUPPLIERS_KEY, JSON.stringify(globalSuppliers));
  } catch (e) {
    console.error('Failed to persist data:', e);
  }
  // Update all subscribed components
  listeners.forEach(listener => listener());
};

export const useStore = () => {
  const [_, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion(v => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const addOrder = useCallback((order: Order) => {
    globalOrders = [order, ...globalOrders];
    notifyListeners();
  }, []);

  const updateOrder = useCallback((updatedOrder: Order) => {
    globalOrders = globalOrders.map(o => o.id === updatedOrder.id ? updatedOrder : o);
    notifyListeners();
  }, []);

  const deleteOrder = useCallback((id: string) => {
    globalOrders = globalOrders.filter(o => o.id !== id);
    notifyListeners();
  }, []);

  const addSupplier = useCallback((supplier: Supplier) => {
    globalSuppliers = [supplier, ...globalSuppliers];
    notifyListeners();
  }, []);

  const updateSupplier = useCallback((updated: Supplier) => {
    globalSuppliers = globalSuppliers.map(s => s.id === updated.id ? updated : s);
    notifyListeners();
  }, []);

  const deleteSupplier = useCallback((id: string) => {
    globalSuppliers = globalSuppliers.filter(s => s.id !== id);
    notifyListeners();
  }, []);

  const getBackupData = useCallback(() => {
    return {
      orders: globalOrders,
      suppliers: globalSuppliers,
      version: '1.3',
      exportedAt: new Date().toISOString()
    };
  }, []);

  const restoreData = useCallback((data: any) => {
    if (!data || !Array.isArray(data.orders)) {
      throw new Error('Неверный формат данных');
    }
    globalOrders = data.orders;
    globalSuppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
    notifyListeners();
  }, []);

  return {
    orders: globalOrders,
    suppliers: globalSuppliers,
    addOrder,
    updateOrder,
    deleteOrder,
    addSupplier,
    updateSupplier,
    deleteSupplier,
    getBackupData,
    restoreData
  };
};
EOF

echo "Creating App.tsx..."
cat > App.tsx <<'EOF'
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
EOF

echo "Creating screens/OrdersScreen.tsx..."
cat > screens/OrdersScreen.tsx <<'EOF'
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Priority, Part } from '../types';
import { 
  Calendar, 
  Tag, 
  AlertCircle, 
  BarChart3, 
  Trash2,
  PackageSearch,
  Users,
  ChevronRight,
  User,
  Smartphone,
  Clock
} from 'lucide-react';
import IncomeModal from '../components/IncomeModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';

type TabType = 'active' | 'archive' | 'sold';
type SortType = 'date' | 'brand' | 'priority' | 'status';

const OrdersScreen: React.FC = () => {
  const { orders, deleteOrder } = useStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [sortBy, setSortBy] = useState<SortType>('date');
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  
  // Gallery State
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  
  // Delete State
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filteredOrders = useMemo(() => {
    let list = orders.filter(o => {
      if (activeTab === 'sold') return o.isSold;
      if (activeTab === 'archive') return o.isArchived && !o.isSold;
      return !o.isArchived && !o.isSold;
    });
    
    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'brand': return a.brand.localeCompare(b.brand);
        case 'priority': {
          const weights = { [Priority.HIGH]: 3, [Priority.MEDIUM]: 2, [Priority.LOW]: 1 };
          return weights[b.priority] - weights[a.priority];
        }
        case 'status': {
          const getFoundStatusScore = (o: Order) => {
            if (o.parts.length === 0) return 0;
            const foundCount = o.parts.filter(p => p.variants.length > 0).length;
            if (foundCount === o.parts.length) return 3; // 100% Found
            if (foundCount > 0) return 2; // Partial
            return 1; // None
          };
          // Sort desc: 100% -> Partial -> None
          return getFoundStatusScore(b) - getFoundStatusScore(a) || (b.createdAt - a.createdAt);
        }
        default: return b.createdAt - a.createdAt;
      }
    });
  }, [orders, activeTab, sortBy]);

  const getStatusColor = (createdAt: number, isSold: boolean) => {
    if (isSold) return 'border-l-4 border-green-700 bg-green-50/50';
    // Keeping consistent left border but adding specific age badge below
    const diff = (Date.now() - createdAt) / (1000 * 60 * 60);
    if (diff < 24) return 'border-l-4 border-green-500';
    if (diff < 48) return 'border-l-4 border-yellow-500';
    return 'border-l-4 border-red-500';
  };

  const getAgeBadge = (createdAt: number) => {
    const diff = (Date.now() - createdAt) / (1000 * 60 * 60);
    let label = '';
    let style = '';

    if (diff < 1) label = 'NEW';
    else if (diff < 24) label = `${Math.floor(diff)}h`;
    else label = `${Math.floor(diff / 24)}d`;

    if (diff < 24) {
      style = 'bg-green-100 text-green-700'; // Subtle green
    } else if (diff < 48) {
      style = 'bg-yellow-100 text-yellow-700'; // Subtle yellow
    } else {
      style = 'bg-red-100 text-red-700'; // Subtle red
    }

    return (
      <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter flex items-center gap-1 ${style}`}>
        <Clock size={8} /> {label}
      </div>
    );
  };

  const getOrderProfit = (order: Order) => {
    if (order.isSold && order.soldProfitUsd !== undefined) return order.soldProfitUsd.toFixed(0);
    
    let totalCostAed = 0;
    let foundParts = 0;
    order.parts.forEach(p => {
      if (p.isFound && p.variants.length > 0) {
        totalCostAed += p.variants[0].priceAed;
        foundParts++;
      }
    });
    if (foundParts === 0) return null;
    const totalSellAed = totalCostAed * (1 + order.markupPercent / 100);
    return ((totalSellAed - totalCostAed) / order.exchangeRate).toFixed(0);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteOrder(deleteId);
      setDeleteId(null);
    }
  };

  const getPartPhoto = (part: Part) => {
    if (part.photos && part.photos.length > 0) return part.photos[0];
    return part.photoUrl;
  };
  
  const getPartPhotos = (part: Part) => {
      if (part.photos && part.photos.length > 0) return part.photos;
      if (part.photoUrl) return [part.photoUrl];
      return [];
  };

  const openGallery = (e: React.MouseEvent, part: Part) => {
    e.stopPropagation();
    const images = getPartPhotos(part);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Мои Заказы</h1>
        <div className="flex gap-2">
          <button 
            type="button"
            onClick={() => setIsIncomeOpen(true)} 
            className="p-3 bg-blue-50 text-blue-600 rounded-xl active:bg-blue-100 transition-colors"
          >
            <BarChart3 size={20} />
          </button>
          <button 
            type="button"
            onClick={() => navigate('/vendor')} 
            className="px-4 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <Users size={16} /> Склад
          </button>
        </div>
      </div>

      <div className="flex p-1 bg-gray-100 rounded-xl shadow-inner">
        {(['active', 'archive', 'sold'] as TabType[]).map((tab) => (
          <button 
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all duration-200 ${activeTab === tab ? 'bg-white shadow-md text-blue-600' : 'text-gray-400'}`}
          >
            {tab === 'active' ? 'Актив' : tab === 'archive' ? 'Архив' : 'Продано'}
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'date', label: 'Дата', icon: Calendar },
          { id: 'brand', label: 'Марка', icon: Tag },
          { id: 'priority', label: 'Приоритет', icon: AlertCircle },
          { id: 'status', label: 'Статус', icon: PackageSearch },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setSortBy(s.id as SortType)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-[10px] font-bold uppercase tracking-tight transition-all ${sortBy === s.id ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-400 border border-gray-100'}`}
          >
            <s.icon size={12} />
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-gray-100 text-gray-300 text-xs font-bold uppercase tracking-widest">
            Заказов нет
          </div>
        ) : (
          filteredOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => navigate(`/order/${order.id}`)}
              className={`bg-white p-4 rounded-3xl shadow-sm border border-gray-100 relative overflow-hidden active:bg-gray-50 transition-colors ${getStatusColor(order.createdAt, order.isSold)}`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h3 className="font-black text-gray-900 text-lg leading-tight uppercase tracking-tight">
                    {order.brand} {order.model}
                  </h3>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-block">
                      <p className="text-[10px] text-gray-700 font-mono font-black uppercase tracking-tight">
                        VIN: {order.vin}
                      </p>
                    </div>
                    {order.clientName && (
                      <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1">
                         <User size={10} className="text-gray-400"/>
                         <p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight truncate max-w-[80px]">
                           {order.clientName}
                         </p>
                      </div>
                    )}
                    <div className="bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-flex items-center gap-1">
                       <Smartphone size={10} className="text-gray-400"/>
                       <p className="text-[10px] text-gray-700 font-bold uppercase tracking-tight">
                         {order.source}
                       </p>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-1">
                   <div className="flex gap-1">
                      {getAgeBadge(order.createdAt)}
                      <div className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-tighter ${
                        order.priority === Priority.HIGH ? 'bg-red-100 text-red-600' :
                        order.priority === Priority.MEDIUM ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-100 text-blue-600'
                      }`}>
                        {order.priority}
                      </div>
                   </div>
                  {getOrderProfit(order) && (
                    <div className="text-green-600 text-xs font-black">
                      +${getOrderProfit(order)}
                    </div>
                  )}
                </div>
              </div>

              {/* Part Names List */}
              <div className="mb-2 px-1">
                <p className="text-xs font-bold text-gray-600 leading-tight line-clamp-2">
                  {order.parts.map(p => p.name).join(', ')}
                </p>
              </div>

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-50">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    {order.parts.slice(0, 3).map((part, i) => {
                      const photo = getPartPhoto(part);
                      return (
                        <div key={part.id} className="w-8 h-8 rounded-lg bg-gray-50 border-2 border-white flex items-center justify-center overflow-hidden shadow-sm relative z-10">
                          {photo ? (
                            <img 
                              src={photo} 
                              className="w-full h-full object-cover cursor-pointer" 
                              onClick={(e) => openGallery(e, part)}
                            />
                          ) : (
                            <PackageSearch size={16} className="text-gray-300" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                    {order.parts.filter(p => p.isFound).length}/{order.parts.length} Найдено
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteId(order.id); }}
                    className="p-4 -m-2 text-gray-200 hover:text-red-500 transition-colors relative z-20"
                  >
                    <Trash2 size={20} />
                  </button>
                  <ChevronRight size={20} className="text-gray-200" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <ConfirmModal 
        isOpen={!!deleteId} 
        message="Вы уверены, что хотите удалить этот заказ?" 
        onConfirm={confirmDelete} 
        onCancel={() => setDeleteId(null)} 
      />
      
      {isIncomeOpen && <IncomeModal isOpen={isIncomeOpen} onClose={() => setIsIncomeOpen(false)} orders={orders} />}
      {gallery && (
        <ImagePreview 
          images={gallery.images} 
          initialIndex={gallery.index} 
          onClose={() => setGallery(null)} 
        />
      )}
    </div>
  );
};

export default OrdersScreen;
EOF

echo "Creating screens/NewOrderScreen.tsx..."
cat > screens/NewOrderScreen.tsx <<'EOF'
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Priority, Source, Order } from '../types';
import { BRANDS, YEARS, DEFAULT_MARKUP, DEFAULT_RATE, SOURCES } from '../constants';
import { Camera, Plus, X, Save, Image as ImageIcon, Trash2, User, Smartphone } from 'lucide-react';
import ImagePreview from '../components/ImagePreview';

const NewOrderScreen: React.FC = () => {
  const { addOrder } = useStore();
  const navigate = useNavigate();
  const carFileRef = useRef<HTMLInputElement>(null);
  const partFileRef = useRef<HTMLInputElement>(null);

  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  
  // Multiple Car Photos
  const [carPhotos, setCarPhotos] = useState<string[]>([]);
  
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(YEARS[0]);
  const [vin, setVin] = useState('');
  const [clientName, setClientName] = useState('');
  const [source, setSource] = useState<Source>(Source.OTHER);
  
  const [partInput, setPartInput] = useState('');
  // Multiple Part Photos (for the current part being added)
  const [partPhotos, setPartPhotos] = useState<string[]>([]);
  
  const [parts, setParts] = useState<{ name: string; photos: string[] }[]>([]);
  
  // Gallery State
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setter(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file as Blob);
      });
    }
  };

  const removePhoto = (index: number, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(prev => prev.filter((_, i) => i !== index));
  };

  const addPart = () => {
    if (partInput.trim()) {
      setParts([...parts, { name: partInput.trim(), photos: [...partPhotos] }]);
      setPartInput('');
      setPartPhotos([]);
    }
  };

  const removePart = (index: number) => {
    setParts(parts.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand || !model) {
      alert('Заполните Марку и Модель');
      return;
    }

    const newOrder: Order = {
      id: Date.now().toString(),
      brand,
      model,
      year,
      vin: vin || '', // Allow empty VIN explicitly
      priority,
      clientName: clientName || '',
      source,
      carPhotos: carPhotos,
      carPhotoUrl: carPhotos[0], // Backward compatibility
      parts: parts.map(p => ({
        id: Math.random().toString(36).substr(2, 9),
        name: p.name,
        photos: p.photos,
        photoUrl: p.photos[0], // Backward compatibility
        variants: [],
        isFound: false
      })),
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: DEFAULT_RATE,
      createdAt: Date.now(),
      isArchived: false,
      isSold: false
    };

    addOrder(newOrder);
    navigate(`/order/${newOrder.id}`);
  };
  
  const openGallery = (images: string[], index = 0) => {
      setGallery({ images, index });
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-6 pb-20">
      <h1 className="text-xl font-bold">Новый Заказ</h1>

      <div className="space-y-2">
        <label className="text-xs font-bold uppercase text-gray-400">Приоритет</label>
        <div className="flex gap-2">
          {[
            { id: Priority.LOW, label: 'Низкий', active: 'bg-blue-600 text-white' },
            { id: Priority.MEDIUM, label: 'Средний', active: 'bg-yellow-600 text-white' },
            { id: Priority.HIGH, label: 'Высокий', active: 'bg-red-600 text-white' }
          ].map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPriority(p.id)}
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${priority === p.id ? p.active : 'bg-white border border-gray-200 text-gray-500'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Car Photos Section */}
      <div className="space-y-2">
        {carPhotos.length === 0 ? (
          <div 
            onClick={() => carFileRef.current?.click()}
            className="w-full h-40 bg-white border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center overflow-hidden relative cursor-pointer active:bg-gray-50 transition-colors"
          >
            <Camera size={32} className="text-gray-300" />
            <span className="text-xs text-gray-400 font-medium mt-2">Фото авто / техпаспорт</span>
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
            <button
              type="button"
              onClick={() => carFileRef.current?.click()}
              className="w-24 h-24 shrink-0 bg-gray-100 rounded-2xl flex items-center justify-center border-2 border-dashed border-gray-200 active:bg-gray-200"
            >
              <Plus size={24} className="text-gray-400" />
            </button>
            {carPhotos.map((photo, idx) => (
              <div key={idx} className="relative w-24 h-24 shrink-0 rounded-2xl overflow-hidden border border-gray-100 group">
                <img 
                  src={photo} 
                  className="w-full h-full object-cover" 
                  onClick={() => openGallery(carPhotos, idx)}
                />
                <button 
                  type="button"
                  onClick={() => removePhoto(idx, setCarPhotos)}
                  className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full backdrop-blur-sm"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <input type="file" ref={carFileRef} onChange={e => handlePhotoSelect(e, setCarPhotos)} className="hidden" accept="image/*" multiple />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold uppercase text-gray-400">Марка</label>
          <select value={brand} onChange={(e) => setBrand(e.target.value)} className="w-full mt-1 bg-white border border-gray-200 p-3 rounded-xl appearance-none outline-none focus:ring-2 focus:ring-blue-500 text-base font-bold">
            <option value="">Выбрать...</option>
            {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold uppercase text-gray-400">Год</label>
          <select value={year} onChange={(e) => setYear(e.target.value)} className="w-full mt-1 bg-white border border-gray-200 p-3 rounded-xl appearance-none outline-none focus:ring-2 focus:ring-blue-500 text-base font-bold">
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs font-bold uppercase text-gray-400">Модель</label>
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Напр. Camry" className="w-full mt-1 bg-white border border-gray-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-base font-bold" />
      </div>

      <div>
        <label className="text-xs font-bold uppercase text-gray-400">VIN</label>
        <input type="text" value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="Необязательно" className="w-full mt-1 bg-white border border-gray-200 p-3 rounded-xl font-mono uppercase outline-none focus:ring-2 focus:ring-blue-500 text-base font-bold" />
      </div>

      {/* Client & Source Block */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 space-y-4">
        <div>
          <label className="text-xs font-bold uppercase text-gray-400 flex items-center gap-1 mb-1">
            <User size={12} /> Имя Клиента
          </label>
          <input 
            type="text" 
            value={clientName} 
            onChange={(e) => setClientName(e.target.value)} 
            placeholder="Введите имя..." 
            className="w-full bg-gray-50 border border-gray-200 p-3 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-base font-bold" 
          />
        </div>
        
        <div>
          <label className="text-xs font-bold uppercase text-gray-400 flex items-center gap-1 mb-2">
            <Smartphone size={12} /> Источник
          </label>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {SOURCES.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap border-2 transition-all ${
                  source === s 
                  ? 'bg-blue-600 text-white border-blue-600' 
                  : 'bg-white text-gray-500 border-gray-100 hover:border-gray-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-bold uppercase text-gray-400">Список деталей (Необязательно)</label>
        
        {/* New Part Input Area */}
        <div className="bg-white border border-gray-200 p-3 rounded-2xl space-y-3">
            <div className="flex gap-2">
                <input 
                  type="text" 
                  value={partInput} 
                  onChange={(e) => setPartInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPart())}
                  placeholder="Название детали..."
                  className="flex-1 bg-gray-50 rounded-xl outline-none p-3 text-base font-bold"
                />
                <button type="button" onClick={addPart} className="p-3 bg-blue-600 text-white rounded-xl active:bg-blue-700 shadow-md">
                    <Plus size={24} />
                </button>
            </div>
            
            {/* Horizontal scroll for part photos */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar items-center">
                <button 
                  type="button" 
                  onClick={() => partFileRef.current?.click()}
                  className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-200 transition-colors ${partPhotos.length > 0 ? 'bg-gray-50' : 'bg-gray-50 text-gray-300'}`}
                >
                   <ImageIcon size={20} />
                </button>
                {partPhotos.map((p, i) => (
                    <div key={i} className="relative w-12 h-12 shrink-0 rounded-xl overflow-hidden border border-gray-100">
                        <img src={p} className="w-full h-full object-cover" />
                        <button 
                            type="button"
                            onClick={() => removePhoto(i, setPartPhotos)}
                            className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 text-white transition-opacity"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ))}
                 <input type="file" ref={partFileRef} onChange={e => handlePhotoSelect(e, setPartPhotos)} className="hidden" accept="image/*" multiple />
            </div>
        </div>

        <div className="flex flex-col gap-2">
          {parts.map((p, i) => (
            <div key={i} className="flex items-center justify-between bg-blue-50 text-blue-900 p-3 rounded-xl">
              <div className="flex items-center gap-3 overflow-hidden">
                {p.photos.length > 0 ? (
                  <div className="flex -space-x-2 shrink-0">
                      {p.photos.slice(0, 3).map((ph, idx) => (
                          <div key={idx} className="w-8 h-8 rounded-lg border-2 border-white overflow-hidden bg-white">
                              <img src={ph} className="w-full h-full object-cover" />
                          </div>
                      ))}
                      {p.photos.length > 3 && (
                          <div className="w-8 h-8 rounded-lg border-2 border-white bg-blue-200 flex items-center justify-center text-[9px] font-bold text-blue-700">
                              +{p.photos.length - 3}
                          </div>
                      )}
                  </div>
                ) : (
                    <div className="w-8 h-8 rounded-lg bg-blue-200/50 flex items-center justify-center text-blue-400">
                        <ImageIcon size={14} />
                    </div>
                )}
                <span className="font-bold text-sm truncate">{p.name}</span>
              </div>
              <button type="button" onClick={() => removePart(i)} className="text-blue-400 p-2 hover:bg-blue-100 rounded-lg">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <button type="submit" className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 sticky bottom-4 shadow-xl active:scale-95 transition-transform">
        <Save size={20} />
        Создать заказ
      </button>

      {gallery && (
        <ImagePreview 
          images={gallery.images} 
          initialIndex={gallery.index} 
          onClose={() => setGallery(null)} 
        />
      )}
    </form>
  );
};

export default NewOrderScreen;
EOF

echo "Creating screens/OrderDetailsScreen.tsx..."
cat > screens/OrderDetailsScreen.tsx <<'EOF'
import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Part, Source } from '../types';
import { SOURCES } from '../constants';
import { 
  ArrowLeft, 
  FileText, 
  ChevronRight, 
  Package, 
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Image as ImageIcon,
  DollarSign,
  AlertTriangle,
  X,
  User,
  Smartphone
} from 'lucide-react';
import EstimateModal from '../components/EstimateModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';

const OrderDetailsScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, updateOrder } = useStore();
  const order = orders.find(o => o.id === id);

  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  
  // Sell Flow State
  const [showSellConfirm, setShowSellConfirm] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);

  const [newPartName, setNewPartName] = useState('');
  // Multiple photos for new part
  const [newPartPhotos, setNewPartPhotos] = useState<string[]>([]);
  const partFileRef = useRef<HTMLInputElement>(null);

  // Exchange Rate Input State (Controlled)
  const [rateInput, setRateInput] = useState(order ? order.exchangeRate.toString() : '3.67');

  // Sync local rate input if order changes
  useEffect(() => {
    if (order) setRateInput(order.exchangeRate.toString());
  }, [order?.id]);

  if (!order) return <div className="p-10 text-center text-gray-400 font-bold">ЗАКАЗ НЕ НАЙДЕН</div>;

  const calculateCurrentProfit = () => {
    const totalCostAed = order.parts.reduce((sum, p) => {
      if (p.isFound && p.variants.length > 0) {
        return sum + p.variants[0].priceAed;
      }
      return sum;
    }, 0);
    const totalSellAed = totalCostAed * (1 + order.markupPercent / 100);
    return (totalSellAed - totalCostAed) / order.exchangeRate;
  };

  const profitUsd = order.isSold && order.soldProfitUsd !== undefined 
    ? order.soldProfitUsd.toFixed(2) 
    : calculateCurrentProfit().toFixed(2);

  const updateOrderField = (field: keyof Order, value: any) => {
    updateOrder({ ...order, [field]: value });
  };

  const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    if (!/^[\d]*[.,]?[\d]*$/.test(rawVal)) return;

    setRateInput(rawVal);
    
    const normalized = rawVal.replace(',', '.');
    const num = parseFloat(normalized);
    
    if (!isNaN(num) && num > 0) {
       updateOrderField('exchangeRate', num);
    }
  };

  const togglePartFound = (partId: string) => {
    const updatedParts = order.parts.map(p => 
      p.id === partId ? { ...p, isFound: !p.isFound } : p
    );
    updateOrder({ ...order, parts: updatedParts });
  };

  const confirmDeletePart = () => {
    if (deletePartId) {
      const updatedParts = order.parts.filter(p => p.id !== deletePartId);
      updateOrder({ ...order, parts: updatedParts });
      setDeletePartId(null);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          setNewPartPhotos(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(file as Blob);
      });
    }
  };

  const removeNewPhoto = (index: number) => {
    setNewPartPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const addNewPart = () => {
    if (!newPartName.trim()) return;
    const newPart: Part = {
      id: Math.random().toString(36).substr(2, 9),
      name: newPartName.trim(),
      photos: newPartPhotos,
      photoUrl: newPartPhotos[0], // Back-compat
      variants: [],
      isFound: false
    };
    updateOrder({ ...order, parts: [...order.parts, newPart] });
    setNewPartName('');
    setNewPartPhotos([]);
  };

  const handleSellClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSellError(null);

    if (order.isSold) {
      setShowSellConfirm(true);
      return;
    }

    const hasPricedItems = order.parts.some(p => p.isFound && p.variants.length > 0);
    if (!hasPricedItems) {
      setSellError("Нельзя продать: нет оцененных деталей");
      setTimeout(() => setSellError(null), 3000);
      return;
    }

    setShowSellConfirm(true);
  };

  const confirmSellOrder = () => {
    if (order.isSold) {
      updateOrder({ ...order, isSold: false, isArchived: false, soldProfitUsd: undefined });
      setShowSellConfirm(false);
    } else {
      const finalProfit = calculateCurrentProfit();
      updateOrder({ 
        ...order, 
        isSold: true, 
        isArchived: true, 
        soldProfitUsd: finalProfit 
      });
      setShowSellConfirm(false);
      navigate('/');
    }
  };

  const getPartPhotos = (part: Part) => {
      if (part.photos && part.photos.length > 0) return part.photos;
      if (part.photoUrl) return [part.photoUrl];
      return [];
  };

  const openGallery = (e: React.MouseEvent, part: Part) => {
    e.stopPropagation();
    const images = getPartPhotos(part);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const MARKUP_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  return (
    <div className="flex flex-col min-h-full bg-gray-50 pb-20 overflow-x-hidden">
      <div className="bg-white p-4 border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => navigate('/')} className="p-3 -ml-2 text-gray-600 active:bg-gray-100 rounded-full transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div className="text-center flex-1 mx-2">
            <h1 className="font-black text-lg leading-tight truncate uppercase">{order.brand} {order.model}</h1>
            <div className="mt-1 bg-gray-900 px-3 py-1 rounded-lg inline-flex items-center gap-1 border border-gray-800 max-w-full">
              <span className="text-[10px] text-gray-500 font-bold">VIN:</span>
              <input 
                type="text" 
                value={order.vin || ''}
                onChange={(e) => updateOrderField('vin', e.target.value.toUpperCase())}
                placeholder="УКАЗАТЬ"
                className="bg-transparent text-xs text-blue-400 font-mono font-black uppercase tracking-widest outline-none w-40 text-left placeholder-gray-700"
              />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {order.isSold && (
              <span className="bg-green-600 text-white text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-tighter shadow-sm">SOLD</span>
            )}
            <button 
              type="button"
              onClick={() => updateOrderField('isArchived', !order.isArchived)} 
              className={`text-[10px] font-black px-2.5 py-1.5 rounded-lg active:scale-95 transition-all uppercase tracking-tight ${order.isArchived ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-600'}`}
            >
              {order.isArchived ? 'Архив' : 'Актив'}
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        
        {/* Client & Source Block */}
        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3">
           <div className="flex-1 min-w-0">
             <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1 mb-1"><User size={10} /> Клиент</label>
             <input 
               type="text" 
               value={order.clientName || ''}
               onChange={(e) => updateOrderField('clientName', e.target.value)}
               placeholder="Имя клиента..."
               className="w-full text-sm font-bold bg-transparent outline-none text-gray-800 placeholder-gray-300"
             />
           </div>
           <div className="w-px h-8 bg-gray-100"></div>
           <div className="flex-1 min-w-0">
             <label className="text-[10px] font-bold text-gray-400 uppercase flex items-center gap-1 mb-1"><Smartphone size={10} /> Источник</label>
             <select 
               value={order.source}
               onChange={(e) => updateOrderField('source', e.target.value)}
               className="w-full text-sm font-bold bg-transparent outline-none text-blue-600 appearance-none truncate"
             >
               {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
             </select>
           </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 relative">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Наценка</span>
            <select 
              value={order.markupPercent}
              onChange={(e) => updateOrderField('markupPercent', Number(e.target.value))}
              className="w-full font-black bg-transparent outline-none border-none p-0 mt-1 text-lg appearance-none relative z-10"
            >
              {MARKUP_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}%</option>
              ))}
            </select>
            <div className="absolute right-3 bottom-4 pointer-events-none text-gray-400">
              <ChevronRight size={14} className="rotate-90" />
            </div>
          </div>
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Курс $</span>
            <input 
              type="text" 
              inputMode="decimal"
              value={rateInput} 
              onChange={handleRateChange}
              onBlur={() => setRateInput(order.exchangeRate.toString())}
              className="w-full font-black bg-transparent outline-none border-none p-0 mt-1 text-lg" 
            />
          </div>
        </div>

        <div className={`p-5 rounded-3xl shadow-lg flex items-center justify-between transition-all duration-300 ${order.isSold ? 'bg-green-800 text-white' : 'bg-green-600 text-white'}`}>
          <div>
            <span className="text-[10px] opacity-80 font-black uppercase tracking-[0.2em]">{order.isSold ? 'Доход (фикс)' : 'Текущая маржа'}</span>
            <div className="text-4xl font-black mt-1 tracking-tight">${profitUsd}</div>
          </div>
          <DollarSign size={48} className="opacity-10" />
        </div>

        {sellError && (
          <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2">
            <AlertTriangle size={16} />
            {sellError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button 
            type="button"
            onClick={() => setIsEstimateOpen(true)} 
            className="py-4.5 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
          >
            <FileText size={18} /> Смета
          </button>
          <button 
            type="button"
            onClick={handleSellClick} 
            className={`py-4.5 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all border-2 ${order.isSold ? 'bg-white border-green-700 text-green-700' : 'bg-green-600 border-green-600 text-white'}`}
          >
            <DollarSign size={18} />
            {order.isSold ? 'Продано' : 'Продать'}
          </button>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em] mb-3">Добавить деталь</h2>
          <form 
            onSubmit={(e) => { e.preventDefault(); addNewPart(); }}
            className="flex flex-col gap-3"
          >
            <div className="flex gap-2">
              <div className="flex-1 flex gap-2 items-center bg-gray-50 border border-gray-100 p-2 rounded-xl">
                <input 
                  type="text" 
                  value={newPartName} 
                  onChange={(e) => setNewPartName(e.target.value)}
                  placeholder="Что ищем?.."
                  className="flex-1 bg-transparent outline-none p-1 text-base font-bold"
                />
              </div>
              <button type="submit" className="p-3 bg-blue-600 text-white rounded-xl active:bg-blue-700 shadow-md">
                <Plus size={24} />
              </button>
            </div>
            
            <div className="flex gap-2 items-center overflow-x-auto no-scrollbar">
                <button 
                  type="button" 
                  onClick={() => partFileRef.current?.click()}
                  className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-200 transition-colors ${newPartPhotos.length > 0 ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-300'}`}
                >
                  <ImageIcon size={20} />
                </button>
                {newPartPhotos.map((p, i) => (
                    <div key={i} className="relative w-12 h-12 shrink-0 rounded-xl overflow-hidden border border-gray-100">
                        <img src={p} className="w-full h-full object-cover" />
                        <button 
                            type="button"
                            onClick={() => removeNewPhoto(i)}
                            className="absolute inset-0 bg-black/40 flex items-center justify-center text-white opacity-0 hover:opacity-100 transition-opacity"
                        >
                            <X size={12} />
                        </button>
                    </div>
                ))}
                <input type="file" ref={partFileRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
            </div>
          </form>
        </div>

        <div className="space-y-2">
          <h2 className="font-black text-gray-400 px-1 text-[10px] uppercase tracking-[0.2em] mb-1">Список запчастей</h2>
          {order.parts.map(part => {
             const displayPhotos = getPartPhotos(part);
             return (
              <div key={part.id} onClick={() => navigate(`/order/${order.id}/part/${part.id}`)} className="bg-white p-3.5 rounded-2xl shadow-sm flex items-center gap-3 active:bg-gray-50 transition-colors border border-gray-50">
                <button 
                  type="button"
                  onClick={(e) => { e.stopPropagation(); togglePartFound(part.id); }} 
                  className={`flex-shrink-0 p-1 rounded-full transition-colors ${part.isFound ? 'text-green-500 bg-green-50' : 'text-gray-200'}`}
                >
                  {part.isFound ? <CheckCircle2 size={28} /> : <Circle size={28} />}
                </button>
                <div 
                  className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden shrink-0 border border-gray-100 relative"
                >
                  {displayPhotos.length > 0 ? (
                    <>
                      <img 
                        src={displayPhotos[0]} 
                        className="w-full h-full object-cover cursor-pointer" 
                        onClick={(e) => openGallery(e, part)}
                      />
                      {displayPhotos.length > 1 && (
                          <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] font-bold px-1 rounded-tl-md">
                              +{displayPhotos.length - 1}
                          </div>
                      )}
                    </>
                  ) : (
                    <Package size={20} className="text-gray-200" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-black text-sm text-gray-800 truncate leading-none mb-1 uppercase tracking-tight">{part.name}</h4>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{part.variants.length} предложений</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button 
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setDeletePartId(part.id); }}
                    className="p-4 -m-2 text-gray-100 hover:text-red-500 transition-all relative z-20"
                  >
                    <Trash2 size={20} />
                  </button>
                  <ChevronRight size={18} className="text-gray-200" />
                </div>
              </div>
             );
          })}
        </div>
      </div>

      <ConfirmModal 
        isOpen={!!deletePartId} 
        message="Вы уверены, что хотите удалить эту деталь?" 
        onConfirm={confirmDeletePart} 
        onCancel={() => setDeletePartId(null)} 
      />

      <ConfirmModal
        isOpen={showSellConfirm}
        message={order.isSold ? "Вернуть заказ в активные?" : "Отметить заказ как проданный?"}
        confirmLabel={order.isSold ? "Да, вернуть" : "Да, продано"}
        confirmClass={order.isSold ? "bg-blue-600 active:bg-blue-700" : "bg-green-600 active:bg-green-700"}
        onConfirm={confirmSellOrder}
        onCancel={() => setShowSellConfirm(false)}
      />

      {isEstimateOpen && <EstimateModal order={order} onClose={() => setIsEstimateOpen(false)} />}
      {gallery && (
        <ImagePreview 
          images={gallery.images} 
          initialIndex={gallery.index} 
          onClose={() => setGallery(null)} 
        />
      )}
    </div>
  );
};

export default OrderDetailsScreen;
EOF

echo "Creating screens/PartDetailsScreen.tsx..."
cat > screens/PartDetailsScreen.tsx <<'EOF'
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { PriceVariant } from '../types';
import { 
  ArrowLeft, 
  Camera, 
  Phone, 
  MapPin, 
  Trash2, 
  Plus, 
  Store,
  Navigation,
  X
} from 'lucide-react';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';

const PartDetailsScreen: React.FC = () => {
  const { orderId, partId } = useParams<{ orderId: string, partId: string }>();
  const navigate = useNavigate();
  const { orders, updateOrder, suppliers, addSupplier, updateSupplier } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const order = orders.find(o => o.id === orderId);
  const part = order?.parts.find(p => p.id === partId);

  const [isAdding, setIsAdding] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deleteVariantId, setDeleteVariantId] = useState<string | null>(null);

  const [priceAed, setPriceAed] = useState('');
  const [shopName, setShopName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  // Multiple photos for variant
  const [variantPhotos, setVariantPhotos] = useState<string[]>([]);
  const [isLocating, setIsLocating] = useState(false);

  // LOGIC: Find the most recently added variant within THIS order
  const latestOrderVariant = useMemo(() => {
    if (!order) return null;
    let latest: PriceVariant | null = null;
    
    order.parts.forEach(p => {
      p.variants.forEach(v => {
        if (!latest || v.createdAt > latest.createdAt) {
          latest = v;
        }
      });
    });
    return latest;
  }, [order]);

  useEffect(() => {
    if (isAdding) {
      if (latestOrderVariant) {
        setShopName(latestOrderVariant.shopName);
        setPhone(latestOrderVariant.phone);
        setLocation(latestOrderVariant.location);
      } else {
        setShopName('');
        setPhone('');
        setLocation('');
      }
    }
  }, [isAdding, latestOrderVariant]);

  if (!order || !part) return <div className="p-10 text-center text-gray-400 font-bold">ДЕТАЛЬ НЕ НАЙДЕНА</div>;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => setVariantPhotos(prev => [...prev, reader.result as string]);
        reader.readAsDataURL(file as Blob);
      });
    }
  };

  const removeVariantPhoto = (index: number) => {
    setVariantPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleShopSelect = (s: any) => {
    setShopName(s.name);
    setPhone(s.phone);
    setLocation(s.location);
    setShowSuggestions(false);
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const link = `https://www.google.com/maps?q=${pos.coords.latitude},${pos.coords.longitude}`;
        setLocation(link);
        setIsLocating(false);
      },
      () => setIsLocating(false)
    );
  };

  const saveVariant = () => {
    if (!priceAed || !shopName) {
      alert('Укажите цену и название магазина');
      return;
    }

    const existingSupplier = suppliers.find(s => s.name.toLowerCase() === shopName.toLowerCase());
    if (!existingSupplier) {
      addSupplier({
        id: Date.now().toString(),
        name: shopName,
        phone,
        location,
        brands: [order.brand]
      });
    } else if (!existingSupplier.brands.includes(order.brand)) {
      updateSupplier({
        ...existingSupplier,
        brands: [...existingSupplier.brands, order.brand]
      });
    }

    const newVariant: PriceVariant = {
      id: Math.random().toString(36).substr(2, 9),
      priceAed: parseFloat(priceAed),
      shopName,
      phone,
      location,
      photos: variantPhotos,
      photoUrl: variantPhotos[0], // Back-compat
      createdAt: Date.now()
    };

    const updatedParts = order.parts.map(p => {
      if (p.id === partId) {
        return {
          ...p,
          isFound: true,
          photoUrl: p.photoUrl || variantPhotos[0], // Set main part photo if none
          photos: (!p.photos || p.photos.length === 0) ? variantPhotos : p.photos,
          variants: [newVariant, ...p.variants]
        };
      }
      return p;
    });

    updateOrder({ ...order, parts: updatedParts });
    setIsAdding(false);
    setPriceAed('');
    setVariantPhotos([]);
  };

  const confirmDeleteVariant = () => {
    if (deleteVariantId) {
      const updatedParts = order.parts.map(p => {
        if (p.id === partId) {
          const newVariants = p.variants.filter(v => v.id !== deleteVariantId);
          return { ...p, variants: newVariants, isFound: newVariants.length > 0 };
        }
        return p;
      });
      updateOrder({ ...order, parts: updatedParts });
      setDeleteVariantId(null);
    }
  };

  const getVariantPhotos = (v: PriceVariant) => {
    if (v.photos && v.photos.length > 0) return v.photos;
    if (v.photoUrl) return [v.photoUrl];
    return [];
  };

  const openGallery = (e: React.MouseEvent, variant: PriceVariant) => {
    e.stopPropagation();
    const images = getVariantPhotos(variant);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(shopName.toLowerCase())
  ).slice(0, 3);

  return (
    <div className="flex flex-col min-h-full bg-gray-50 pb-10 overflow-x-hidden">
      <div className="bg-white p-4 border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate(`/order/${orderId}`)} className="p-3 -ml-2 text-gray-600 active:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={24} /></button>
          <div className="text-center flex-1 mx-2">
            <h1 className="font-black text-lg truncate leading-tight uppercase tracking-tight">{part.name}</h1>
            <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{order.brand} {order.model}</p>
          </div>
          <div className="w-10" />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {!isAdding ? (
          <button 
            type="button"
            onClick={() => setIsAdding(true)}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all uppercase text-xs"
          >
            <Plus size={22} /> Добавить вариант
          </button>
        ) : (
          <form 
            onSubmit={(e) => { e.preventDefault(); saveVariant(); }}
            className="bg-white rounded-3xl shadow-xl overflow-hidden border border-blue-50 animate-in slide-in-from-bottom duration-300"
          >
            <div className="p-5 space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="font-black text-blue-600 uppercase tracking-tighter">Новая цена</h3>
                <button type="button" onClick={() => setIsAdding(false)} className="p-2 text-gray-300 active:text-gray-500"><Trash2 size={22} /></button>
              </div>

              <div className="flex flex-col gap-4">
                 {/* Multiple Photo Upload UI */}
                 <div className="flex gap-2 overflow-x-auto no-scrollbar items-center pb-1">
                     <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-24 h-24 bg-gray-50 rounded-2xl flex flex-col items-center justify-center border-2 border-dashed border-gray-200 shrink-0 cursor-pointer active:bg-gray-100 transition-colors"
                      >
                         <Camera size={26} className="text-gray-300" />
                         <span className="text-[10px] text-gray-400 font-black tracking-tighter uppercase mt-1">ФОТО</span>
                      </div>
                      {variantPhotos.map((p, i) => (
                          <div key={i} className="relative w-24 h-24 shrink-0 rounded-2xl overflow-hidden border border-gray-200">
                              <img src={p} className="w-full h-full object-cover" />
                              <button 
                                  type="button" 
                                  onClick={() => removeVariantPhoto(i)}
                                  className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 backdrop-blur-sm"
                              >
                                  <X size={12} />
                              </button>
                          </div>
                      ))}
                      <input type="file" ref={fileInputRef} onChange={handlePhotoChange} className="hidden" accept="image/*" multiple />
                 </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Цена (AED)</label>
                  <input 
                    type="number" 
                    autoFocus 
                    value={priceAed} 
                    onChange={(e) => setPriceAed(e.target.value)} 
                    placeholder="0" 
                    className="w-full text-4xl font-black bg-transparent border-b-4 border-blue-500 outline-none p-0 focus:border-blue-600 text-blue-600" 
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Магазин</label>
                  <div className="flex items-center gap-3 mt-1 bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-inner">
                    <Store size={20} className="text-gray-400" />
                    <input type="text" value={shopName} onChange={(e) => { setShopName(e.target.value); setShowSuggestions(true); }} className="flex-1 bg-transparent outline-none font-bold text-base" placeholder="Dubai Spare..." />
                  </div>
                  {showSuggestions && shopName && filteredSuppliers.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 bg-white shadow-2xl rounded-2xl mt-1 border border-gray-100 overflow-hidden">
                      {filteredSuppliers.map(s => (
                        <button key={s.id} type="button" onClick={() => handleShopSelect(s)} className="w-full text-left p-4 border-b border-gray-50 last:border-none flex items-center justify-between active:bg-blue-50">
                          <div><div className="font-bold text-sm uppercase tracking-tight">{s.name}</div><div className="text-[10px] text-gray-400 font-black">{s.phone}</div></div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Телефон</label>
                  <div className="flex items-center gap-3 mt-1 bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-inner">
                    <Phone size={20} className="text-gray-400" />
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="flex-1 bg-transparent outline-none font-bold text-base" placeholder="+971..." />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Локация</label>
                  <div className="flex gap-2 mt-1">
                    <div className="flex-1 flex items-center gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-inner">
                      <MapPin size={20} className="text-gray-400" />
                      <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} className="flex-1 bg-transparent outline-none font-bold text-base" placeholder="Ряд / Рядом с..." />
                    </div>
                    <button 
                      type="button"
                      onClick={getCurrentLocation}
                      disabled={isLocating}
                      className={`p-4 rounded-2xl flex items-center justify-center shadow-md transition-all ${isLocating ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white active:scale-95'}`}
                    >
                      <Navigation size={22} className={isLocating ? 'animate-pulse' : ''} />
                    </button>
                  </div>
                </div>
              </div>

              <button type="submit" className="w-full py-4.5 bg-blue-600 text-white rounded-2xl font-black shadow-xl active:scale-[0.98] transition-all tracking-wider uppercase text-xs">СОХРАНИТЬ ВАРИАНТ</button>
            </div>
          </form>
        )}

        <div className="space-y-4 pt-4">
          <h2 className="font-black text-gray-400 px-1 uppercase text-[10px] tracking-[0.2em]">История цен ({part.variants.length})</h2>
          {part.variants.map(variant => {
             const displayPhotos = getVariantPhotos(variant);
             return (
              <div key={variant.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 flex gap-4">
                  {displayPhotos.length > 0 && (
                    <div className="relative w-24 h-24 shrink-0">
                        <img 
                          src={displayPhotos[0]} 
                          onClick={(e) => openGallery(e, variant)}
                          className="w-full h-full object-cover rounded-2xl cursor-pointer shadow-sm" 
                        />
                        {displayPhotos.length > 1 && (
                            <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-tl-lg">
                                +{displayPhotos.length - 1}
                            </div>
                        )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex justify-between items-start">
                      <div className="text-2xl font-black text-blue-600 tracking-tight">{variant.priceAed} AED</div>
                      <button 
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeleteVariantId(variant.id); }}
                        className="p-4 -m-2 text-gray-200 hover:text-red-500 transition-all relative z-20"
                      >
                        <Trash2 size={20} />
                      </button>
                    </div>
                    <h4 className="font-black text-gray-800 mt-1 truncate uppercase tracking-tighter text-sm">{variant.shopName}</h4>
                    <div className="mt-auto pt-2 space-y-1">
                      <div className="flex items-center gap-2 text-xs text-gray-500 font-bold"><Phone size={12} className="shrink-0" /> {variant.phone || '—'}</div>
                      <div className="flex items-center gap-2 text-xs text-gray-400 font-bold truncate"><MapPin size={12} className="shrink-0" /> {variant.location || '—'}</div>
                    </div>
                  </div>
                </div>
              </div>
             );
          })}
        </div>
      </div>

      <ConfirmModal 
        isOpen={!!deleteVariantId} 
        message="Вы уверены, что хотите удалить это предложение?" 
        onConfirm={confirmDeleteVariant} 
        onCancel={() => setDeleteVariantId(null)} 
      />

      {gallery && (
        <ImagePreview 
          images={gallery.images} 
          initialIndex={gallery.index} 
          onClose={() => setGallery(null)} 
        />
      )}
    </div>
  );
};

export default PartDetailsScreen;
EOF

echo "Creating components/EstimateModal.tsx..."
cat > components/EstimateModal.tsx <<'EOF'
import React from 'react';
import { Order } from '../types';
import { X, CheckCircle2 } from 'lucide-react';

interface Props {
  order: Order;
  onClose: () => void;
}

const EstimateModal: React.FC<Props> = ({ order, onClose }) => {
  const foundParts = order.parts.filter(p => p.isFound && p.variants.length > 0);
  
  const totalUsd = foundParts.reduce((sum, p) => {
    const costAed = p.variants[0].priceAed;
    const sellAed = costAed * (1 + order.markupPercent / 100);
    return sum + (sellAed / order.exchangeRate);
  }, 0);
  
  const carPhoto = (order.carPhotos && order.carPhotos.length > 0) ? order.carPhotos[0] : order.carPhotoUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-300 flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Compact Header */}
        <div className="relative bg-gray-900 text-white p-3 shrink-0 overflow-hidden">
          {carPhoto && (
            <div className="absolute inset-0 z-0">
              <img src={carPhoto} className="w-full h-full object-cover opacity-40" />
              <div className="absolute inset-0 bg-gradient-to-b from-gray-900/90 via-gray-900/70 to-gray-900/95" />
            </div>
          )}

          <div className="relative z-10 flex flex-col items-center w-full">
            <button onClick={onClose} className="absolute top-0 right-0 p-1 text-white/50 active:text-white transition-colors"><X size={20} /></button>
            <div className="bg-blue-600 px-2 py-0.5 rounded text-[8px] font-black tracking-widest uppercase mb-1 shadow-sm border border-blue-400/30">DUBAI SPARES CIS</div>
            <h2 className="text-base font-black text-center leading-tight shadow-black drop-shadow-md uppercase tracking-tight">{order.brand} {order.model} {order.year}</h2>
            <div className="mt-1 bg-gray-900/80 backdrop-blur-sm px-2 py-0.5 rounded border border-gray-700">
              <p className="text-[10px] font-mono font-bold tracking-widest text-blue-400 uppercase">{order.vin}</p>
            </div>
          </div>
        </div>

        {/* Dense List */}
        <div className="flex-1 overflow-y-auto p-2 bg-white">
          <div className="space-y-0.5">
            {foundParts.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-xs italic">Нет найденных деталей</div>
            ) : (
              foundParts.map(part => {
                const costAed = part.variants[0].priceAed;
                const sellAed = costAed * (1 + order.markupPercent / 100);
                const sellUsd = (sellAed / order.exchangeRate).toFixed(0);
                const photo = (part.photos && part.photos.length > 0) ? part.photos[0] : part.photoUrl;
                
                return (
                  <div key={part.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-none">
                    {/* Tiny Thumbnail */}
                    <div className="w-8 h-8 bg-gray-50 rounded-lg overflow-hidden flex-shrink-0 border border-gray-100">
                      {photo ? <img src={photo} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-blue-50/30 flex items-center justify-center text-blue-200 font-bold text-[8px]">IMG</div>}
                    </div>
                    
                    {/* Name */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                      <div className="font-bold text-xs text-gray-800 truncate leading-none">{part.name}</div>
                      <div className="text-[9px] text-green-600 font-bold uppercase tracking-wider mt-0.5 flex items-center gap-1">
                        <CheckCircle2 size={8} /> В наличии
                      </div>
                    </div>
                    
                    {/* Price */}
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-gray-900 leading-none">${sellUsd}</div>
                      <div className="text-[8px] text-gray-400 font-bold mt-0.5">{sellAed.toFixed(0)} AED</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Compact Footer */}
        <div className="p-3 bg-gray-50 border-t border-gray-200 shrink-0">
          <div className="flex justify-between items-end mb-2 border-b border-dashed border-gray-200 pb-2">
            <div>
              <div className="text-[8px] font-bold text-gray-400 uppercase tracking-widest">Итого</div>
              <div className="flex items-baseline gap-1.5">
                <div className="text-2xl font-black text-blue-600 leading-none">${totalUsd.toFixed(0)}</div>
                <div className="text-xs font-bold text-gray-400">{(totalUsd * order.exchangeRate).toFixed(0)} AED</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[8px] font-bold text-gray-300 uppercase leading-none">Комиссия вкл.</div>
              <div className="text-[8px] font-bold text-gray-400 uppercase mt-0.5 leading-none">ID: {order.id.slice(-4)}</div>
            </div>
          </div>
          <p className="text-[8px] text-gray-400 font-bold uppercase tracking-tighter text-center">Срок доставки уточняется при оформлении</p>
        </div>
      </div>
    </div>
  );
};

export default EstimateModal;
EOF

echo "Creating components/VendorSlider.tsx..."
cat > components/VendorSlider.tsx <<'EOF'
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { X, ChevronLeft, ChevronRight, Package, Car, Filter, Image as ImageIcon } from 'lucide-react';
import ImagePreview from './ImagePreview';

const VendorSlider: React.FC = () => {
  const navigate = useNavigate();
  const { orders } = useStore();
  
  // Only show active orders in vendor view
  const activeOrders = useMemo(() => orders.filter(o => !o.isArchived && !o.isSold), [orders]);

  const [selectedBrand, setSelectedBrand] = useState<string>('All');
  const [index, setIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Gallery State for Part Photos
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  const brands = useMemo(() => {
    const b = new Set(activeOrders.map(o => o.brand));
    return ['All', ...Array.from(b).sort()];
  }, [activeOrders]);

  const filteredOrders = useMemo(() => {
    const list = selectedBrand === 'All' ? activeOrders : activeOrders.filter(o => o.brand === selectedBrand);
    setIndex(0); // Reset index on filter change
    return list;
  }, [activeOrders, selectedBrand]);

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > 50;
    const isRightSwipe = distance < -50;

    if (isLeftSwipe && index < filteredOrders.length - 1) {
      setIndex(prev => prev + 1);
    }
    if (isRightSwipe && index > 0) {
      setIndex(prev => prev - 1);
    }
  };

  const onClose = () => {
    navigate(-1); // Go back to previous screen
  };

  const openGallery = (e: React.MouseEvent, photos: string[] | undefined, photoUrl: string | undefined) => {
    e.stopPropagation();
    const images = (photos && photos.length > 0) ? photos : (photoUrl ? [photoUrl] : []);
    if (images.length === 0) return;
    setGallery({ images, index: 0 });
  };

  const order = filteredOrders[index];
  const carPhoto = order ? ((order.carPhotos && order.carPhotos.length > 0) ? order.carPhotos[0] : order.carPhotoUrl) : null;

  return (
    <div 
      className="absolute inset-0 z-50 bg-gray-950 flex flex-col h-full w-full"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="p-4 flex items-center justify-between border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-gray-400" />
          <select 
            value={selectedBrand} 
            onChange={(e) => setSelectedBrand(e.target.value)}
            className="bg-transparent text-white font-bold text-sm outline-none border-none py-1"
          >
            {brands.map(b => <option key={b} value={b} className="bg-gray-900">{b}</option>)}
          </select>
        </div>
        <button onClick={onClose} className="p-2 text-white bg-gray-800 rounded-full active:scale-90 transition-transform"><X size={24} /></button>
      </div>

      {filteredOrders.length > 0 ? (
        <>
          <div className="flex-1 overflow-y-auto no-scrollbar relative">
            <div key={order.id} className="flex flex-col h-full animate-in slide-in-from-right-10 duration-500">
              <div className="relative h-64 bg-gray-900 overflow-hidden shrink-0">
                {carPhoto ? (
                  <img src={carPhoto} className="w-full h-full object-cover opacity-60" alt="Car" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Car size={80} className="text-gray-800" /></div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950 to-transparent" />
                <div className="absolute bottom-6 left-0 right-0 text-center px-4">
                  <h1 className="text-3xl font-black text-white leading-none">{order.brand} {order.model}</h1>
                  <p className="text-gray-400 font-bold mt-2">{order.year} год выпуска</p>
                </div>
              </div>

              <div className="p-6 space-y-8">
                <div className="bg-blue-600/10 border border-blue-500/20 p-6 rounded-3xl text-center">
                  <div className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em] mb-3">VIN НОМЕР</div>
                  <div className="text-2xl font-mono font-black text-white break-all tracking-wider">{order.vin}</div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2"><Package size={14} /> Список запчастей</h3>
                  <div className="grid gap-3">
                    {order.parts.map(p => {
                      const photo = (p.photos && p.photos.length > 0) ? p.photos[0] : p.photoUrl;
                      const hasPhotos = !!photo;
                      
                      return (
                        <div key={p.id} className="bg-gray-900 border border-gray-800 p-4 rounded-2xl flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className={`w-3 h-3 rounded-full shrink-0 ${p.variants.length > 0 ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-gray-700'}`} />
                            <span className="text-xl font-bold text-gray-200 leading-tight">{p.name}</span>
                          </div>
                          {hasPhotos && (
                            <button 
                              onClick={(e) => openGallery(e, p.photos, p.photoUrl)}
                              className="w-12 h-12 rounded-xl bg-gray-800 border border-gray-700 overflow-hidden shrink-0 active:scale-95 transition-transform relative"
                            >
                              <img src={photo} className="w-full h-full object-cover" />
                              {(p.photos && p.photos.length > 1) && (
                                <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[9px] font-bold px-1 rounded-tl">
                                  +{p.photos.length - 1}
                                </div>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 bg-gray-950 border-t border-gray-900 flex items-center justify-between gap-4 shrink-0 pb-10">
            <button disabled={index === 0} onClick={() => setIndex(index - 1)} className="flex-1 py-4 bg-gray-900 text-white rounded-2xl flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"><ChevronLeft size={24} /></button>
            <div className="text-white font-mono text-sm">{index + 1} / {filteredOrders.length}</div>
            <button disabled={index === filteredOrders.length - 1} onClick={() => setIndex(index + 1)} className="flex-1 py-4 bg-gray-900 text-white rounded-2xl flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"><ChevronRight size={24} /></button>
          </div>
          
          {gallery && (
            <ImagePreview 
              images={gallery.images} 
              initialIndex={gallery.index} 
              onClose={() => setGallery(null)} 
            />
          )}
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
          <Car size={48} className="opacity-20" />
          <p>Нет заказов для этой марки</p>
        </div>
      )}
    </div>
  );
};

export default VendorSlider;
EOF

echo "Creating components/IncomeModal.tsx..."
cat > components/IncomeModal.tsx <<'EOF'
import React from 'react';
import { Order } from '../types';
import { X, TrendingUp, Calendar, DollarSign } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
}

const IncomeModal: React.FC<Props> = ({ isOpen, onClose, orders }) => {
  if (!isOpen) return null;

  const orderStats = orders
    .filter(o => o.isSold)
    .map(o => {
      let profitUsd = o.soldProfitUsd;
      
      if (profitUsd === undefined) {
        const totalCostAed = o.parts.reduce((sum, p) => (p.isFound && p.variants.length > 0) ? sum + p.variants[0].priceAed : sum, 0);
        profitUsd = totalCostAed > 0 ? ((totalCostAed * (1 + o.markupPercent / 100)) - totalCostAed) / o.exchangeRate : 0;
      }
      
      return { ...o, profitUsd };
    });

  const totalIncome = orderStats.reduce((sum, o) => sum + o.profitUsd, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white w-full max-w-md rounded-t-[32px] overflow-hidden animate-in slide-in-from-bottom duration-300 h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 pb-2 border-b border-gray-50 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-bold">Доход компании</h2>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full"><X size={20} /></button>
        </div>

        <div className="p-6 flex-1 overflow-y-auto no-scrollbar space-y-6">
          <div className="bg-green-600 text-white p-8 rounded-[24px] shadow-xl text-center relative overflow-hidden">
            <TrendingUp size={120} className="absolute -right-4 -bottom-4 opacity-10" />
            <span className="text-sm font-medium opacity-80 uppercase tracking-widest text-green-100">Итоговая чистая прибыль</span>
            <div className="text-5xl font-black mt-2">${totalIncome.toFixed(0)}</div>
          </div>

          <div className="space-y-3 pb-10">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest px-1">Проданные заказы ({orderStats.length})</h3>
            {orderStats.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm italic">Проданных заказов пока нет</div>
            ) : (
              orderStats.map(o => (
                <div key={o.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                  <div>
                    <div className="font-bold text-sm uppercase tracking-tight">{o.brand} {o.model}</div>
                    <div className="text-[10px] text-gray-400 font-bold flex items-center gap-1 mt-0.5 uppercase tracking-tighter">
                      <Calendar size={10} /> {new Date(o.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-lg font-black text-green-600">+${o.profitUsd.toFixed(0)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default IncomeModal;
EOF

echo "Creating components/ImagePreview.tsx..."
cat > components/ImagePreview.tsx <<'EOF'
import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  images: string[];
  initialIndex?: number;
  onClose: () => void;
}

const ImagePreview: React.FC<Props> = ({ images, initialIndex = 0, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Handle key navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') nextImage();
      if (e.key === 'ArrowLeft') prevImage();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex]);

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      nextImage();
    } else if (isRightSwipe) {
      prevImage();
    }
  };

  const nextImage = () => {
    if (currentIndex < images.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const prevImage = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  // If no images, close
  if (!images || images.length === 0) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-0 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 p-2 bg-white/10 text-white rounded-full hover:bg-white/20 transition-colors z-50 backdrop-blur-md"
      >
        <X size={24} />
      </button>

      {/* Navigation Buttons (Visible on desktop/large screens) */}
      {images.length > 1 && (
        <>
          <button 
            onClick={(e) => { e.stopPropagation(); prevImage(); }}
            className={`absolute left-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-md transition-all ${currentIndex === 0 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`}
            disabled={currentIndex === 0}
          >
            <ChevronLeft size={32} />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); nextImage(); }}
            className={`absolute right-4 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-md transition-all ${currentIndex === images.length - 1 ? 'opacity-30 cursor-not-allowed' : 'opacity-100'}`}
            disabled={currentIndex === images.length - 1}
          >
            <ChevronRight size={32} />
          </button>
        </>
      )}

      {/* Counter */}
      {images.length > 1 && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 text-white rounded-full text-xs font-bold backdrop-blur-md border border-white/10">
          {currentIndex + 1} / {images.length}
        </div>
      )}

      <div 
        className="w-full h-full flex items-center justify-center overflow-hidden touch-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img 
          src={images[currentIndex]} 
          alt={`Preview ${currentIndex + 1}`} 
          className="max-w-full max-h-full object-contain transition-transform duration-200"
          onClick={(e) => e.stopPropagation()} 
        />
      </div>

      {/* Dots Indicator */}
      {images.length > 1 && (
        <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2">
          {images.map((_, idx) => (
            <div 
              key={idx} 
              className={`w-2 h-2 rounded-full transition-all ${idx === currentIndex ? 'bg-white scale-125' : 'bg-white/30'}`} 
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ImagePreview;
EOF

echo "Creating components/ConfirmModal.tsx..."
cat > components/ConfirmModal.tsx <<'EOF'
import React from 'react';

interface Props {
  isOpen: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClass?: string;
}

const ConfirmModal: React.FC<Props> = ({ 
  isOpen, 
  message, 
  onConfirm, 
  onCancel,
  confirmLabel = 'Да, удалить',
  cancelLabel = 'Отмена',
  confirmClass = 'bg-red-600 active:bg-red-700'
}) => {
  if (!isOpen) return null;
  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" 
      onClick={onCancel}
    >
      <div 
        className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 border border-gray-100" 
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-center mb-6 text-gray-900 leading-tight">{message}</h3>
        <div className="flex gap-3">
          <button 
            onClick={onCancel} 
            className="flex-1 py-3.5 bg-gray-100 rounded-2xl font-black text-gray-600 active:bg-gray-200 transition-colors uppercase text-xs tracking-wider"
          >
            {cancelLabel}
          </button>
          <button 
            onClick={onConfirm} 
            className={`flex-1 py-3.5 rounded-2xl font-black text-white transition-colors shadow-lg uppercase text-xs tracking-wider ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
EOF

echo "Creating screens/SuppliersScreen.tsx..."
cat > screens/SuppliersScreen.tsx <<'EOF'
import React, { useState, useRef } from 'react';
import { useStore } from '../store';
import { Supplier } from '../types';
import { 
  Search, 
  Phone, 
  MapPin, 
  MessageSquare, 
  Store,
  ChevronRight,
  UserPlus,
  Download,
  Upload,
  Trash2,
  Tag,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';

const SuppliersScreen: React.FC = () => {
  const { suppliers, addSupplier, deleteSupplier, getBackupData, restoreData } = useStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteSupplierId, setDeleteSupplierId] = useState<string | null>(null);
  
  // Import State
  const [importFile, setImportFile] = useState<any>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');

  const filtered = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.phone.includes(searchTerm) ||
    s.brands.some(b => b.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSave = () => {
    if (!name) return;
    addSupplier({
      id: Date.now().toString(),
      name,
      phone,
      location,
      brands: []
    });
    setName(''); setPhone(''); setLocation('');
    setIsAdding(false);
  };

  const handleExport = () => {
    try {
      const data = getBackupData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // Format: dubai_spares_backup_YYYY-MM-DD.json
      link.download = `dubai_spares_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Ошибка при создании резервной копии');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (Array.isArray(json.orders) && Array.isArray(json.suppliers)) {
          setImportFile(json);
          setImportError(null);
        } else {
          setImportError('Неверный формат файла (отсутствуют заказы или поставщики)');
          setTimeout(() => setImportError(null), 3000);
        }
      } catch (err) {
        setImportError('Ошибка чтения файла. Убедитесь, что это корректный JSON.');
        setTimeout(() => setImportError(null), 3000);
      }
      // Reset input so same file can be selected again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const confirmRestore = () => {
    if (importFile) {
      try {
        restoreData(importFile);
        setImportFile(null);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
      } catch (e) {
        setImportError('Ошибка при восстановлении данных');
        setTimeout(() => setImportError(null), 3000);
      }
    }
  };

  const openMap = (loc: string) => {
    if (!loc) return;
    if (loc.startsWith('http')) {
      window.open(loc, '_blank');
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`, '_blank');
    }
  };

  const confirmDeleteSupplier = () => {
    if (deleteSupplierId) {
      deleteSupplier(deleteSupplierId);
      setDeleteSupplierId(null);
    }
  };

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">База Поставщиков</h1>
        <div className="flex gap-2">
          <button 
            type="button"
            onClick={handleExport}
            className="p-2.5 bg-gray-100 text-gray-600 rounded-xl active:bg-gray-200 transition-colors"
            title="Скачать резервную копию"
          >
            <Download size={20} />
          </button>
          <button 
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 bg-gray-100 text-gray-600 rounded-xl active:bg-gray-200 transition-colors"
            title="Восстановить из файла"
          >
            <Upload size={20} />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileSelect} 
            className="hidden" 
            accept=".json" 
          />
          <button 
            type="button"
            onClick={() => setIsAdding(true)}
            className="p-2.5 bg-blue-600 text-white rounded-xl shadow-md active:bg-blue-700 transition-colors"
          >
            <UserPlus size={20} />
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input 
          type="text" 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Поиск магазина, телефона или марки..."
          autoComplete="off"
          className="w-full pl-12 pr-4 py-3.5 bg-white border border-gray-200 rounded-2xl shadow-sm outline-none focus:ring-2 focus:ring-blue-500 font-medium text-base"
        />
      </div>

      {importError && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2 border border-red-100">
          <AlertTriangle size={16} />
          {importError}
        </div>
      )}

      {showSuccess && (
        <div className="bg-green-50 text-green-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in slide-in-from-top-2 border border-green-100">
          <CheckCircle2 size={16} />
          Данные успешно восстановлены!
        </div>
      )}

      {isAdding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
            className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-5" 
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold">Новый Поставщик</h2>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Название магазина</label>
                <input 
                  placeholder="Dubai Parts LTD" 
                  value={name} onChange={e => setName(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Телефон</label>
                <input 
                  placeholder="+971..." 
                  value={phone} onChange={e => setPhone(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Локация / Карта</label>
                <input 
                  placeholder="Ссылка или описание..." 
                  value={location} onChange={e => setLocation(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold active:bg-gray-200 transition-colors uppercase text-xs">Отмена</button>
              <button type="submit" className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg active:bg-blue-700 transition-colors uppercase text-xs">Добавить</button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="py-20 text-center opacity-30 italic flex flex-col items-center gap-3">
            <Store size={48} />
            Поставщики не найдены
          </div>
        ) : (
          filtered.map(s => (
            <div key={s.id} className="bg-white p-4 rounded-2xl shadow-sm space-y-4 border border-gray-100 active:bg-gray-50 transition-colors">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                    <Store size={24} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-lg leading-tight truncate">{s.name}</h3>
                    <p className="text-xs text-gray-400 flex items-center gap-1 mt-1 truncate">
                      <MapPin size={12} className="shrink-0" /> {s.location || 'Локация не указана'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {s.location && (
                    <button 
                      type="button"
                      onClick={() => openMap(s.location)}
                      className="p-3 bg-red-50 text-red-600 rounded-xl active:bg-red-100 transition-colors"
                      title="Карта"
                    >
                      <MapPin size={20} />
                    </button>
                  )}
                  <a 
                    href={`tel:${s.phone}`} 
                    className="p-3 bg-green-50 text-green-600 rounded-xl active:bg-green-100 transition-colors"
                  >
                    <Phone size={20} />
                  </a>
                  <div onClick={(e) => e.stopPropagation()}>
                    <button 
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteSupplierId(s.id); }}
                      className="p-4 -m-1 bg-gray-50 text-gray-300 hover:text-red-500 active:bg-red-50 rounded-xl transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              </div>

              {s.brands.length > 0 && (
                <div className="pt-2 flex flex-wrap gap-1.5 border-t border-gray-50">
                  {s.brands.map(b => (
                    <span key={b} className="bg-gray-50 text-gray-500 text-[9px] font-bold px-2 py-0.5 rounded-md uppercase border border-gray-100 flex items-center gap-1">
                      <Tag size={8} /> {b}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <ConfirmModal 
        isOpen={!!deleteSupplierId} 
        message="Вы уверены, что хотите удалить этого поставщика?" 
        onConfirm={confirmDeleteSupplier} 
        onCancel={() => setDeleteSupplierId(null)} 
      />

      <ConfirmModal 
        isOpen={!!importFile}
        message={`Восстановить резервную копию?\n\nДата: ${importFile?.exportedAt ? new Date(importFile.exportedAt).toLocaleDateString() : 'Неизвестно'}\nЗаказов: ${importFile?.orders?.length || 0}\nПоставщиков: ${importFile?.suppliers?.length || 0}\n\nВНИМАНИЕ: Все текущие данные будут заменены!`}
        confirmLabel="Восстановить"
        cancelLabel="Отмена"
        confirmClass="bg-red-600"
        onConfirm={confirmRestore}
        onCancel={() => setImportFile(null)}
      />
    </div>
  );
};

export default SuppliersScreen;
EOF

echo "========================================================"
echo "Project structure created successfully!"
echo "========================================================"
echo "Files created:"
find . -maxdepth 2 -not -path '*/.*'
echo "========================================================"
echo "Checksums (SHA256):"
shasum -a 256 package.json index.html vite.config.ts App.tsx 2>/dev/null || sha256sum package.json index.html vite.config.ts App.tsx
echo "========================================================"
echo "INSTRUCTIONS:"
echo "1. cd $PROJECT_NAME"
echo "2. npm install"
echo "3. npm run dev"
echo "========================================================"
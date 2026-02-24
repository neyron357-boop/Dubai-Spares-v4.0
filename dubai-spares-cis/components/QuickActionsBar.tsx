import React from 'react';
import { Search, Crosshair, RefreshCw, FileText, Flag } from 'lucide-react';

interface QuickActionsBarProps {
  onSearch: () => void;
  onNextBest: () => void;
  onRecalculate: () => void;
  onActiveOrder: () => void;
  onEndSession: () => void;
  disabled?: boolean;
}

const QuickActionsBar: React.FC<QuickActionsBarProps> = ({
  onSearch,
  onNextBest,
  onRecalculate,
  onActiveOrder,
  onEndSession,
  disabled = false
}) => (
  <div className="sticky bottom-2 z-20 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur">
    <div className="grid grid-cols-5 gap-1 text-[10px] font-black">
      <button type="button" onClick={onSearch} className="rounded-xl border border-slate-200 bg-slate-50 py-2 text-slate-700 inline-flex flex-col items-center gap-1" disabled={disabled}><Search size={13} />Search</button>
      <button type="button" onClick={onNextBest} className="rounded-xl border border-violet-200 bg-violet-50 py-2 text-violet-700 inline-flex flex-col items-center gap-1" disabled={disabled}><Crosshair size={13} />Next best</button>
      <button type="button" onClick={onRecalculate} className="rounded-xl border border-blue-200 bg-blue-50 py-2 text-blue-700 inline-flex flex-col items-center gap-1" disabled={disabled}><RefreshCw size={13} />Recalc</button>
      <button type="button" onClick={onActiveOrder} className="rounded-xl border border-amber-200 bg-amber-50 py-2 text-amber-700 inline-flex flex-col items-center gap-1" disabled={disabled}><FileText size={13} />Order</button>
      <button type="button" onClick={onEndSession} className="rounded-xl border border-rose-200 bg-rose-50 py-2 text-rose-700 inline-flex flex-col items-center gap-1" disabled={disabled}><Flag size={13} />End</button>
    </div>
  </div>
);

export default QuickActionsBar;

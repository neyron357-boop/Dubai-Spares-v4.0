import React, { useMemo, useState } from 'react';
import { ArrowLeft, CheckSquare, ExternalLink, Plus, Settings, ShoppingBag, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const actionPills = [
  { label: 'Open Order', icon: ShoppingBag, tone: 'cyan' },
  { label: 'Suppliers (1)', icon: Users, tone: 'cyan' },
  { label: 'Checklist', icon: CheckSquare, tone: 'purple' },
  { label: 'Vehicle S...', icon: Settings, tone: 'purple' },
] as const;

const partsData = {
  searching: [{ id: 1, title: 'HOOD PANEL', subtitle: 'Variant: 1 • Body Panel', image: 'https://images.unsplash.com/photo-1615906655593-ad0386982a0f?w=300&auto=format&fit=crop' }],
  found: [
    { id: 2, title: 'FRONT GRILLE', subtitle: 'Variant: 1 • Body Panel', image: 'https://images.unsplash.com/photo-1486496572940-2bb2341fdbdf?w=300&auto=format&fit=crop' },
    { id: 3, title: 'HEADLIGHT LH', subtitle: 'Variant: 1 • Lighting', image: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=300&auto=format&fit=crop' },
  ],
};

const VendorSlidesScreen: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'searching' | 'found'>('found');
  const activeList = useMemo(() => partsData[activeTab], [activeTab]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#101114] text-white" style={{ fontFamily: 'Inter, SF Pro Display, sans-serif' }}>
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideRight { from { opacity: 0; transform: translateX(-20px);} to { opacity: 1; transform: translateX(0);} }
        @keyframes glowPulse { 0% { opacity: 0.45; } 50% { opacity: 1; } 100% { opacity: 0.45; } }
        @keyframes fabBreath { 0% { box-shadow: 0 0 10px rgba(0,229,255,.45);} 50% {box-shadow: 0 0 20px rgba(0,229,255,.7);} 100% {box-shadow: 0 0 10px rgba(0,229,255,.45);} }
        .glass { backdrop-filter: blur(12px); background: linear-gradient(180deg, rgba(255,255,255,.15), rgba(255,255,255,.08)); }
        .entry-fade { animation: fadeIn .3s ease-out both; }
        .entry-up { animation: slideUp .45s cubic-bezier(.22,.99,.33,1) both; }
        .entry-right { animation: slideRight .35s ease-out both; }
      `}</style>

      <div className="relative h-[45vh] min-h-[330px] overflow-hidden entry-fade">
        <img src="https://images.unsplash.com/photo-1493238792000-8113da705763?w=1400&auto=format&fit=crop" alt="car" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/20 to-transparent" />
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 700" fill="none">
          <path d="M240 390 C 350 300, 620 280, 760 360" stroke="#00E5FF" strokeWidth="4" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 5px #00E5FF)', animation: 'glowPulse 2.6s infinite' }} />
          <path d="M300 440 L700 440" stroke="#00E5FF" strokeWidth="3" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 7px #00E5FF)', opacity: activeTab === 'found' ? 1 : 0.45, animation: 'glowPulse 1.8s infinite' }} />
        </svg>

        <div className="absolute left-4 right-4 top-[max(18px,env(safe-area-inset-top))] rounded-3xl border border-cyan-300/35 p-4 glass entry-up" style={{ animationDelay: '.2s' }}>
          <button type="button" onClick={() => navigate('/orders')} className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-300/45 px-3 py-1 text-xs active:scale-95">
            <ArrowLeft size={14} /> Back
          </button>
          <p className="text-2xl font-bold">Lexus ALTEEZ A</p>
          <p className="mt-1 text-sm text-white/80">2001 <span className="px-1 text-[#00E5FF]">•</span> SXE10</p>
        </div>
      </div>

      <div className="relative z-10 -mt-8 rounded-t-[32px] border-t border-cyan-400/30 bg-[#16181e]/90 px-4 pb-[max(24px,calc(env(safe-area-inset-bottom)+20px))] pt-4 backdrop-blur-xl entry-up" style={{ animationDelay: '.35s' }}>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {actionPills.map((pill, idx) => {
            const Icon = pill.icon;
            const color = pill.tone === 'cyan' ? 'border-[#00E5FF]/70' : 'border-[#7C3AED]/70';
            return (
              <button key={pill.label} type="button" className={`inline-flex shrink-0 items-center gap-[6px] rounded-full border ${color} px-4 py-2 text-sm active:scale-95 entry-right`} style={{ animationDelay: `${0.45 + idx * 0.05}s` }}>
                <Icon size={14} /> {pill.label}
              </button>
            );
          })}
        </div>

        <div className="mb-4 rounded-full bg-[#1F2128] p-1">
          <div className="relative grid grid-cols-2 text-center text-sm">
            {(['searching', 'found'] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`relative z-10 py-2 transition-colors ${activeTab === tab ? 'text-white' : 'text-white/45'} active:scale-95`}>
                {tab === 'searching' ? 'Searching (1)' : 'Found (2)'}
              </button>
            ))}
            <div className="absolute bottom-0 h-[3px] w-1/2 rounded-full bg-[#00E5FF] transition-transform duration-300" style={{ transform: activeTab === 'searching' ? 'translateX(0%)' : 'translateX(100%)', boxShadow: '0 0 14px rgba(0,229,255,.85)' }} />
          </div>
        </div>

        <div className="space-y-3">
          {activeList.length === 0 ? (
            <div className="flex items-center justify-center rounded-2xl border border-cyan-400/50 p-8">
              <svg width="120" height="50" viewBox="0 0 120 50" style={{ animation: 'glowPulse 2s infinite' }}><path d="M8 34 L22 20 L85 20 L108 30 L98 34 Z" fill="none" stroke="#00E5FF" strokeWidth="2" /></svg>
            </div>
          ) : (
            activeList.map((part, idx) => (
              <button key={part.id} type="button" className="w-full rounded-2xl border border-cyan-400/35 bg-gradient-to-b from-white/10 to-white/[0.04] p-2 text-left active:scale-[0.97] entry-up" style={{ animationDelay: `${idx * 0.05}s`, boxShadow: '-2px -2px 0 rgba(0,229,255,.45)' }}>
                <div className="flex items-center gap-3">
                  <img src={part.image} alt={part.title} className="h-16 w-16 rounded-xl object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold tracking-wide">{part.title}</p>
                    <p className="mt-0.5 text-xs text-white/55">{part.subtitle}</p>
                    <span className="mt-1 inline-flex rounded-full bg-[#22C55E] px-2 py-0.5 text-[10px] font-semibold text-white">In Stock</span>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#00E5FF] text-[#00E5FF]"><ExternalLink size={16} /></span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <button type="button" className="fixed bottom-[max(20px,calc(env(safe-area-inset-bottom)+12px))] right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-[#00E5FF] text-black active:scale-95" style={{ animation: 'fabBreath 2.2s ease-in-out infinite', boxShadow: '0 0 25px rgba(0,229,255,.6)' }}>
        <Plus size={24} />
      </button>
    </div>
  );
};

export default VendorSlidesScreen;

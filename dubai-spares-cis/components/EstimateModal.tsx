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

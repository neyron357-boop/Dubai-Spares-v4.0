import React, { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Part, Priority } from '../types';
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
  Star
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
  const [showSellConfirm, setShowSellConfirm] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);

  const [newPartName, setNewPartName] = useState('');
  const [newPartPhotos, setNewPartPhotos] = useState<string[]>([]);
  const partFileRef = useRef<HTMLInputElement>(null);

  const [noteText, setNoteText] = useState('');
  const [notePhotos, setNotePhotos] = useState<string[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);

  if (!order) return <div className="p-10 text-center text-gray-400 font-bold">ЗАКАЗ НЕ НАЙДЕН</div>;

  const updateOrderField = (field: keyof Order, value: any) => updateOrder({ ...order, [field]: value });

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (!e.target.files?.length) return;
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setter(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file as Blob);
    });
  };

  const getPartPhotos = (part: Part) => part.photos?.length ? part.photos : (part.photoUrl ? [part.photoUrl] : []);
  const getCarPhotos = () => order.carPhotos?.length ? order.carPhotos : (order.carPhotoUrl ? [order.carPhotoUrl] : []);

  const addNewPart = () => {
    if (!newPartName.trim()) return;
    const newPart: Part = {
      id: Math.random().toString(36).slice(2, 9),
      name: newPartName.trim(),
      photos: newPartPhotos,
      photoUrl: newPartPhotos[0],
      variants: [],
      isFound: false
    };
    updateOrder({ ...order, parts: [...order.parts, newPart] });
    setNewPartName('');
    setNewPartPhotos([]);
  };

  const addNote = () => {
    if (!noteText.trim() && notePhotos.length === 0) return;
    const note = { id: Math.random().toString(36).slice(2, 9), text: noteText.trim(), photos: notePhotos, createdAt: Date.now() };
    updateOrder({ ...order, notes: [note, ...(order.notes ?? [])] });
    setNoteText('');
    setNotePhotos([]);
  };

  const calculateCurrentProfit = () => {
    const totalCostAed = order.parts.reduce((sum, p) => p.isFound && p.variants.length > 0 ? sum + p.variants[0].priceAed : sum, 0);
    return (totalCostAed * (order.markupPercent / 100)) / order.exchangeRate;
  };

  const confirmSellOrder = () => {
    if (order.isSold) updateOrder({ ...order, isSold: false, isArchived: false, soldProfitUsd: undefined });
    else updateOrder({ ...order, isSold: true, isArchived: true, soldProfitUsd: calculateCurrentProfit() });
    setShowSellConfirm(false);
  };

  const carPhotos = getCarPhotos();

  return (
    <div className="flex flex-col min-h-full bg-gray-50 pb-20 overflow-x-hidden">
      <div className="bg-white p-4 border-b border-gray-100 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => navigate('/')} className="p-3 -ml-2 text-gray-600"><ArrowLeft size={24} /></button>
          <h1 className="font-black text-lg leading-tight truncate uppercase">{order.brand} {order.model}</h1>
          <button onClick={() => updateOrderField('isVip', !order.isVip)} className={`p-2 rounded-xl ${order.isVip ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}><Star size={18} /></button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {carPhotos.length > 0 && (
          <div className="bg-white p-3 rounded-2xl border border-gray-100 space-y-3">
            <button onClick={() => setGallery({ images: carPhotos, index: 0 })} className="w-full h-44 rounded-2xl overflow-hidden relative border border-gray-100">
              <img src={carPhotos[0]} className="w-full h-full object-cover" />
              {carPhotos.length > 1 && <div className="absolute right-2 bottom-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded-full">+{carPhotos.length - 1}</div>}
            </button>
            <button onClick={() => setGallery({ images: carPhotos, index: 0 })} className="w-full py-2 text-xs font-black rounded-xl bg-gray-900 text-white">Открыть фото на весь экран</button>
          </div>
        )}

        <div className="bg-white p-3 rounded-2xl border border-gray-100 grid grid-cols-2 gap-3">
          <input value={order.clientName || ''} onChange={(e) => updateOrderField('clientName', e.target.value)} placeholder="Клиент" className="bg-gray-50 p-3 rounded-xl font-bold" />
          <input value={order.vin || ''} onChange={(e) => updateOrderField('vin', e.target.value.toUpperCase())} placeholder="VIN" className="bg-gray-50 p-3 rounded-xl font-bold uppercase" />
          <select value={order.priority} onChange={(e) => updateOrderField('priority', e.target.value as Priority)} className="bg-gray-50 p-3 rounded-xl font-bold">
            <option value={Priority.LOW}>LOW</option>
            <option value={Priority.MEDIUM}>MEDIUM</option>
            <option value={Priority.HIGH}>HIGH</option>
          </select>
          <button onClick={() => setShowSellConfirm(true)} className={`p-3 rounded-xl font-black ${order.isSold ? 'bg-white border border-green-600 text-green-600' : 'bg-green-600 text-white'}`}>
            <DollarSign size={16} className="inline mr-1" /> {order.isSold ? 'Продано' : 'Продать'}
          </button>
        </div>

        {sellError && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-xs font-bold flex items-center gap-2"><AlertTriangle size={16} />{sellError}</div>}

        <button type="button" onClick={() => setIsEstimateOpen(true)} className="w-full py-3 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2"><FileText size={18} /> Смета</button>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em] mb-3">Добавить деталь</h2>
          <div className="flex gap-2 mb-2">
            <input type="text" value={newPartName} onChange={(e) => setNewPartName(e.target.value)} placeholder="Что ищем?.." className="flex-1 bg-gray-50 border border-gray-100 p-2 rounded-xl font-bold" />
            <button type="button" onClick={addNewPart} className="p-3 bg-blue-600 text-white rounded-xl"><Plus size={20} /></button>
          </div>
          <div className="flex gap-2 items-center overflow-x-auto no-scrollbar">
            <button type="button" onClick={() => partFileRef.current?.click()} className="w-12 h-12 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center"><ImageIcon size={18} /></button>
            {newPartPhotos.map((p, i) => (
              <button key={i} type="button" onClick={() => setGallery({ images: newPartPhotos, index: i })} className="relative w-12 h-12 rounded-xl overflow-hidden">
                <img src={p} className="w-full h-full object-cover" />
              </button>
            ))}
            <input type="file" ref={partFileRef} onChange={(e) => handlePhotoChange(e, setNewPartPhotos)} className="hidden" accept="image/*" multiple />
          </div>
        </div>

        <div className="space-y-2">
          {order.parts.map(part => {
            const displayPhotos = getPartPhotos(part);
            return (
              <div key={part.id} onClick={() => navigate(`/order/${order.id}/part/${part.id}`)} className="bg-white p-3.5 rounded-2xl shadow-sm flex items-center gap-3 border border-gray-50">
                <button type="button" onClick={(e) => { e.stopPropagation(); updateOrder({ ...order, parts: order.parts.map(p => p.id === part.id ? { ...p, isFound: !p.isFound } : p) }); }} className={`flex-shrink-0 p-1 rounded-full ${part.isFound ? 'text-green-500 bg-green-50' : 'text-gray-200'}`}>{part.isFound ? <CheckCircle2 size={28} /> : <Circle size={28} />}</button>
                <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center overflow-hidden shrink-0 border border-gray-100 relative">
                  {displayPhotos.length > 0 ? <img src={displayPhotos[0]} className="w-full h-full object-cover" onClick={(e) => { e.stopPropagation(); setGallery({ images: displayPhotos, index: 0 }); }} /> : <Package size={20} className="text-gray-200" />}
                </div>
                <div className="flex-1 min-w-0"><h4 className="font-black text-sm text-gray-800 truncate uppercase tracking-tight">{part.name}</h4></div>
                <button type="button" onClick={(e) => { e.stopPropagation(); setDeletePartId(part.id); }} className="p-2 text-gray-200"><Trash2 size={18} /></button>
                <ChevronRight size={18} className="text-gray-200" />
              </div>
            );
          })}
        </div>

        <div className="bg-white p-4 rounded-2xl border border-gray-100 space-y-3">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em]">Заметки</h2>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Текст заметки..." className="w-full bg-gray-50 p-3 rounded-xl font-semibold min-h-20" />
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <button type="button" onClick={() => noteFileRef.current?.click()} className="w-12 h-12 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center"><ImageIcon size={18} /></button>
            {notePhotos.map((p, i) => (
              <button key={i} type="button" onClick={() => setGallery({ images: notePhotos, index: i })} className="w-12 h-12 rounded-xl overflow-hidden"><img src={p} className="w-full h-full object-cover" /></button>
            ))}
            <input type="file" ref={noteFileRef} onChange={(e) => handlePhotoChange(e, setNotePhotos)} className="hidden" accept="image/*" multiple />
          </div>
          <button onClick={addNote} className="w-full py-2 rounded-xl bg-blue-600 text-white font-black">Добавить заметку</button>

          {(order.notes ?? []).map(note => (
            <div key={note.id} className="border border-gray-100 rounded-xl p-3">
              {note.text && <p className="text-sm font-semibold text-gray-700 mb-2">{note.text}</p>}
              {note.photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  {note.photos.map((p, i) => (
                    <button key={i} onClick={() => setGallery({ images: note.photos, index: i })} className="w-14 h-14 rounded-lg overflow-hidden shrink-0"><img src={p} className="w-full h-full object-cover" /></button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ConfirmModal isOpen={!!deletePartId} message="Вы уверены, что хотите удалить эту деталь?" onConfirm={() => {
        if (!deletePartId) return;
        updateOrder({ ...order, parts: order.parts.filter(p => p.id !== deletePartId) });
        setDeletePartId(null);
      }} onCancel={() => setDeletePartId(null)} />

      <ConfirmModal isOpen={showSellConfirm} message={order.isSold ? 'Вернуть заказ в активные?' : 'Отметить заказ как проданный?'} onConfirm={confirmSellOrder} onCancel={() => setShowSellConfirm(false)} />
      {isEstimateOpen && <EstimateModal order={order} onClose={() => setIsEstimateOpen(false)} />}
      {gallery && <ImagePreview images={gallery.images} initialIndex={gallery.index} onClose={() => setGallery(null)} />}
    </div>
  );
};

export default OrderDetailsScreen;

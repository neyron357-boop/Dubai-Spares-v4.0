import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Order, Part, Priority, OrderNote, Shop } from '../types';
import { SOURCES } from '../constants';
import { 
  ArrowLeft, 
  FileText, 
  Share2,
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
  Smartphone,
  Star,
  Mic,
  Square,
  Play,
  Pause
} from 'lucide-react';
import EstimateModal from '../components/EstimateModal';
import ImagePreview from '../components/ImagePreview';
import ConfirmModal from '../components/ConfirmModal';
import { buildPartShareText, shareMessage } from '../shareUtils';
import { supabase } from '../supabase';

const SALES_STATUSES = ['Inquiry', 'Price Sent', 'Pending Approval', 'Paid', 'Completed'] as const;


const toRad = (v: number) => (v * Math.PI) / 180;
const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const calc =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
};


const OrderDetailsScreen: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, isLoading, updateOrder } = useStore();
  const order = orders.find(o => o.id === id);

  const [isEstimateOpen, setIsEstimateOpen] = useState(false);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);
  const [deletePartId, setDeletePartId] = useState<string | null>(null);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNotePhotos, setNewNotePhotos] = useState<string[]>([]);
  const [newNoteAudios, setNewNoteAudios] = useState<string[]>([]);
  const noteFileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Sell Flow State
  const [showSellConfirm, setShowSellConfirm] = useState(false);
  const [sellError, setSellError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioProgress, setAudioProgress] = useState<Record<string, number>>({});
  const [shops, setShops] = useState<Shop[]>([]);
  const [currentPosition, setCurrentPosition] = useState<{ lat: number; lng: number } | null>(null);

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



  useEffect(() => {
    let active = true;
    const loadShops = async () => {
      if (!supabase) return;
      const { data } = await supabase.from('shops').select('id,name,phone,location,latitude,longitude,specialization');
      if (!active || !Array.isArray(data)) return;
      setShops(data.map((row: any) => ({
        id: String(row.id),
        name: row.name || 'Shop',
        phone: row.phone || '',
        location: row.location || '',
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        specialization: Array.isArray(row.specialization) ? row.specialization : []
      })));
    };
    void loadShops();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setCurrentPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });
  }, []);

  if (!order && isLoading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-10 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-200 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
        <div className="h-24 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

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


  const recommendedShops = shops
    .filter((shop) => shop.specialization.some((brand) => brand.toLowerCase() === order.brand.toLowerCase()))
    .map((shop) => ({
      ...shop,
      distance: currentPosition ? distanceMeters(currentPosition, { lat: shop.latitude, lng: shop.longitude }) : Number.MAX_SAFE_INTEGER
    }))
    .sort((a, b) => a.distance - b.distance);

  const navigateToShop = (shop: Shop) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${shop.latitude},${shop.longitude}`, '_blank');
  };

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

  const confirmSellOrder = async () => {
    if (order.isSold) {
      await updateOrder({ ...order, isSold: false, isArchived: false, soldProfitUsd: undefined });
      setShowSellConfirm(false);
    } else {
      const finalProfit = calculateCurrentProfit();
      const ok = await updateOrder({ 
        ...order, 
        isSold: true, 
        isArchived: true, 
        soldProfitUsd: finalProfit 
      });
      setShowSellConfirm(false);
      if (ok) navigate('/');
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

  const getCarPhotos = () => {
    if (order.carPhotos && order.carPhotos.length > 0) return order.carPhotos;
    if (order.carPhotoUrl) return [order.carPhotoUrl];
    return [];
  };

  const handleNotePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => setNewNotePhotos(prev => [...prev, reader.result as string]);
        reader.readAsDataURL(file as Blob);
      });
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      recorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Запись аудио не поддерживается на этом устройстве');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.onloadend = () => {
          setNewNoteAudios(prev => [...prev, reader.result as string]);
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (e) {
      console.error('Audio recording failed', e);
      alert('Не удалось начать запись');
    }
  };

  const toggleAudioPlayback = (id: string) => {
    const audioEl = document.getElementById(id) as HTMLAudioElement | null;
    if (!audioEl) return;

    if (playingAudioId === id) {
      audioEl.pause();
      setPlayingAudioId(null);
      return;
    }

    if (playingAudioId) {
      const prev = document.getElementById(playingAudioId) as HTMLAudioElement | null;
      prev?.pause();
      if (playingAudioId !== id) {
        setAudioProgress(prevState => ({ ...prevState, [playingAudioId]: 0 }));
      }
    }

    audioEl.play().catch(() => setPlayingAudioId(null));
    setPlayingAudioId(id);
    audioEl.ontimeupdate = () => {
      const progress = audioEl.duration ? Math.min(100, (audioEl.currentTime / audioEl.duration) * 100) : 0;
      setAudioProgress(prev => ({ ...prev, [id]: progress }));
    };
    audioEl.onended = () => {
      setPlayingAudioId(null);
      setAudioProgress(prev => ({ ...prev, [id]: 0 }));
    };
  };


  const addNote = () => {
    if (!newNoteText.trim() && newNotePhotos.length === 0 && newNoteAudios.length === 0) return;
    const note: OrderNote = {
      id: Math.random().toString(36).slice(2, 9),
      text: newNoteText.trim(),
      photos: newNotePhotos,
      audios: newNoteAudios,
      createdAt: Date.now()
    };
    updateOrder({ ...order, notes: [note, ...(order.notes || [])] });
    setNewNoteText('');
    setNewNotePhotos([]);
    setNewNoteAudios([]);
  };

  const MARKUP_OPTIONS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

  return (
    <div className="flex flex-col min-h-full overflow-x-hidden bg-gray-50 pb-20">
      <div className="p-4 sticky top-0 z-10 shadow-sm backdrop-blur bg-white border-b border-gray-100">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => navigate('/')} className="p-3 -ml-2 rounded-full transition-colors text-gray-600 active:bg-gray-100">
            <ArrowLeft size={24} />
          </button>
          <div className="text-center flex-1 mx-2">
            <h1 className="font-black text-lg leading-tight truncate uppercase">{order.brand} {order.model}</h1>
            <div className="mt-1 px-3 py-1 rounded-lg inline-flex items-center gap-1 border max-w-full bg-gray-900 border-gray-800">
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
          <div className="w-10" />
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar pb-1">
          {order.isSold && <span className="bg-green-600 text-white text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tighter shadow-sm">SOLD</span>}
          <button type="button" onClick={() => updateOrderField('isVip', !order.isVip)} className={`text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight shrink-0 ${order.isVip ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
            <span className="inline-flex items-center gap-1"><Star size={12} /> VIP</span>
          </button>
          <button type="button" onClick={() => updateOrderField('isLead', !order.isLead)} className={`text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight shrink-0 ${order.isLead ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>LEAD</button>
          <select value={order.salesStatus || 'Inquiry'} onChange={(e) => updateOrderField('salesStatus', e.target.value)} className="text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight bg-white border border-gray-200 text-gray-700 shrink-0">
            {SALES_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={order.priority} onChange={(e) => updateOrderField('priority', e.target.value as Priority)} className="text-[10px] font-black px-3 py-2 rounded-xl uppercase tracking-tight bg-white border border-gray-200 text-gray-700 shrink-0">
            <option value={Priority.HIGH}>HIGH</option>
            <option value={Priority.MEDIUM}>MEDIUM</option>
            <option value={Priority.LOW}>LOW</option>
          </select>
          <button 
            type="button"
            onClick={() => updateOrderField('isArchived', !order.isArchived)} 
            className={`text-[10px] font-black px-3 py-2 rounded-xl active:scale-95 transition-all uppercase tracking-tight shrink-0 ${order.isArchived ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-600'}`}
          >
            {order.isArchived ? 'Архив' : 'Актив'}
          </button>
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

        {getCarPhotos().length > 0 && (
          <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Фото авто</div>
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {getCarPhotos().map((ph, i) => (
                <button key={i} type="button" className="w-20 h-20 rounded-xl overflow-hidden border border-gray-100 shrink-0" onClick={(e) => { e.stopPropagation(); setGallery({ images: getCarPhotos(), index: i }); }}>
                  <img src={ph} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        )}

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

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 space-y-3">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em]">Заметки</h2>
          <textarea value={newNoteText} onChange={(e) => setNewNoteText(e.target.value)} placeholder="Текст заметки..." className="w-full bg-gray-50 border border-gray-100 rounded-xl p-3 text-sm font-semibold outline-none" rows={3} />
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            <button type="button" onClick={() => noteFileRef.current?.click()} className="w-12 h-12 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 flex items-center justify-center"><ImageIcon size={18} /></button>
            <button type="button" onClick={toggleRecording} className={`w-12 h-12 rounded-xl border-2 ${isRecording ? 'border-red-300 bg-red-50 text-red-600' : 'border-gray-200 text-gray-500'} flex items-center justify-center`}>{isRecording ? <Square size={16} /> : <Mic size={16} />}</button>
            {newNotePhotos.map((p, i) => <img key={i} src={p} className="w-12 h-12 rounded-xl object-cover border border-gray-100" />)}
            {newNoteAudios.map((_, i) => <div key={`na-${i}`} className="px-3 h-12 rounded-xl bg-blue-50 border border-blue-100 text-[10px] font-bold text-blue-600 flex items-center">Voice {i + 1}</div>)}
            <input type="file" ref={noteFileRef} onChange={handleNotePhotoChange} className="hidden" accept="image/*" multiple />
          </div>
          <button type="button" onClick={addNote} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-wide">Добавить заметку</button>
          {(order.notes || []).length > 0 && (
            <div className="space-y-2">
              {(order.notes || []).map(n => (
                <div key={n.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  {n.text && <p className="text-sm font-semibold text-gray-700">{n.text}</p>}
                  {n.photos && n.photos.length > 0 && <div className="flex gap-2 mt-2 overflow-x-auto no-scrollbar">{n.photos.map((ph, idx) => <button key={idx} type="button" onClick={() => setGallery({ images: n.photos || [], index: idx })} className="w-12 h-12 rounded-lg overflow-hidden"><img src={ph} className="w-full h-full object-cover" /></button>)}</div>}
                  {n.audios && n.audios.length > 0 && <div className="space-y-2 mt-2">{n.audios.map((audioSrc, idx) => { const audioId = `note-${n.id}-${idx}`; const isPlaying = playingAudioId === audioId; return <div key={audioId} className="flex items-center gap-2 bg-white border border-gray-200 rounded-full px-3 py-2"><button type="button" onClick={() => toggleAudioPlayback(audioId)} className="w-7 h-7 rounded-full bg-green-600 text-white flex items-center justify-center">{isPlaying ? <Pause size={13} /> : <Play size={13} className="ml-0.5" />}</button><div className="h-1 flex-1 rounded-full bg-gray-200"><div className="h-1 rounded-full bg-green-500 transition-all" style={{ width: `${audioProgress[audioId] || 0}%` }} /></div><audio id={audioId} src={audioSrc} preload="metadata" playsInline /></div>; })}</div>}
                </div>
              ))}
            </div>
          )}
        </div>


        <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 space-y-2">
          <h2 className="font-black text-gray-400 text-[10px] uppercase tracking-[0.2em]">Recommended Shops</h2>
          {recommendedShops.length === 0 ? (
            <p className="text-xs text-gray-400">Нет подходящих магазинов для бренда {order.brand || '—'}.</p>
          ) : (
            <div className="space-y-2">
              {recommendedShops.slice(0, 6).map((shop) => (
                <div key={shop.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{shop.name}</p>
                    <p className="text-[11px] text-gray-500 truncate">{Number.isFinite(shop.distance) ? `${Math.round(shop.distance)}m` : 'distance unavailable'}</p>
                  </div>
                  <button type="button" onClick={() => navigateToShop(shop)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white">
                    Navigate
                  </button>
                </div>
              ))}
            </div>
          )}
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
                    onClick={(e) => { e.stopPropagation(); void shareMessage(buildPartShareText(order, part)); }}
                    className="p-4 -m-2 text-gray-200 hover:text-emerald-600 transition-all"
                  >
                    <Share2 size={18} />
                  </button>
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

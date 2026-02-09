import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store';
import { Priority, Source, Order } from '../types';
import { BRANDS, YEARS, DEFAULT_MARKUP, DEFAULT_RATE, SOURCES } from '../constants';
import { Camera, Plus, X, Save, Image as ImageIcon, Trash2, User, Smartphone, Star, Gem } from 'lucide-react';
import ImagePreview from '../components/ImagePreview';

const NewOrderScreen: React.FC = () => {
  const { addOrder, isSyncing } = useStore();
  const navigate = useNavigate();
  const carFileRef = useRef<HTMLInputElement>(null);
  const partFileRef = useRef<HTMLInputElement>(null);

  const [isVip, setIsVip] = useState(false);
  const [isLead, setIsLead] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
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
      isSold: false,
      isVip,
      isLead,
      isPinned: false,
      notes: []
    };

    try {
      const ok = await addOrder(newOrder);
      if (ok) {
        navigate('/');
      }
    } catch {
      // error state is handled globally in store/app toast
    }
  };
  
  const openGallery = (images: string[], index = 0) => {
      setGallery({ images, index });
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-6 pb-20">
      <h1 className="text-xl font-bold">Новый Заказ</h1>

      <div className="bg-white p-3 rounded-2xl border border-gray-200 space-y-2">
        <label className="text-xs font-bold uppercase text-gray-400">Тип клиента</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setIsVip(v => !v)} className={`py-2.5 rounded-xl text-sm font-bold border transition-all inline-flex items-center justify-center gap-1.5 ${isVip ? 'bg-gradient-to-br from-yellow-400 to-amber-500 text-white border-yellow-500' : 'bg-white text-gray-500 border-gray-200'}`}><Star size={14} /> VIP</button>
          <button type="button" onClick={() => setIsLead(v => !v)} className={`py-2.5 rounded-xl text-sm font-bold border transition-all inline-flex items-center justify-center gap-1.5 ${isLead ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-200'}`}><Gem size={14} /> Lead</button>
        </div>
      </div>

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

      <button type="submit" disabled={isSyncing} className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 sticky bottom-4 shadow-xl active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed">
        <Save size={20} />
        {isSyncing ? 'Сохранение...' : 'Создать заказ'}
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

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrderStore } from '../store'; // Исправлено на useOrderStore
import { Priority, Source, Order } from '../types';
import { BRANDS, YEARS, DEFAULT_MARKUP, DEFAULT_RATE, SOURCES } from '../constants';
import { Camera, Plus, X, Save, Image as ImageIcon, Trash2, User, Smartphone } from 'lucide-react';
import ImagePreview from '../components/ImagePreview';

const NewOrderScreen: React.FC = () => {
  const addOrder = useOrderStore((state) => state.addOrder); // Исправлено
  const navigate = useNavigate();
  const carFileRef = useRef<HTMLInputElement>(null);
  const partFileRef = useRef<HTMLInputElement>(null);

  const [priority, setPriority] = useState<Priority>(Priority.MEDIUM);
  const [carPhotos, setCarPhotos] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState(YEARS[0]);
  const [vin, setVin] = useState('');
  const [clientName, setClientName] = useState('');
  const [source, setSource] = useState<Source>(Source.OTHER);
  const [partInput, setPartInput] = useState('');
  const [partPhotos, setPartPhotos] = useState<string[]>([]);
  const [parts, setParts] = useState<{ name: string; photos: string[] }[]>([]);
  const [gallery, setGallery] = useState<{ images: string[]; index: number } | null>(null);

  const handleCarPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setCarPhotos(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const handlePartPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setPartPhotos(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const addPart = () => {
    if (!partInput.trim()) return;
    setParts([...parts, { name: partInput.trim(), photos: partPhotos }]);
    setPartInput('');
    setPartPhotos([]);
  };

  const removePart = (index: number) => {
    setParts(parts.filter((_, i) => i !== index));
  };

  const removeCarPhoto = (index: number) => {
    setCarPhotos(carPhotos.filter((_, i) => i !== index));
  };

  const removePartPhoto = (index: number) => {
    setPartPhotos(partPhotos.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand || !model || parts.length === 0) {
      alert('Заполните марку, модель и добавьте хотя бы одну деталь');
      return;
    }

    const newOrder: Order = {
      id: Date.now().toString(),
      brand,
      model,
      year,
      vin,
      priority,
      clientName,
      source,
      carPhotos,
      parts: parts.map(p => ({
        id: Math.random().toString(36).substr(2, 9),
        name: p.name,
        photos: p.photos,
        variants: [],
        isFound: false
      })),
      markupPercent: DEFAULT_MARKUP,
      exchangeRate: DEFAULT_RATE,
      createdAt: Date.now(),
      isArchived: false,
      isSold: false
    };

    await addOrder(newOrder);
    navigate('/');
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-6 pb-32">
      <div className="flex items-center gap-2 mb-2">
        <button type="button" onClick={() => navigate(-1)} className="p-2 -ml-2">
          <X size={24} />
        </button>
        <h1 className="text-2xl font-black uppercase tracking-tight">Новый заказ</h1>
      </div>

      {/* Приоритет */}
      <div className="grid grid-cols-3 gap-2">
        {(Object.values(Priority) as Priority[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPriority(p)}
            className={`py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
              priority === p 
                ? 'bg-gray-900 text-white shadow-lg scale-[1.02]' 
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Фото автомобиля */}
      <div className="space-y-3">
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Фото автомобиля</label>
        <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
          <button
            type="button"
            onClick={() => carFileRef.current?.click()}
            className="w-24 h-24 shrink-0 bg-gray-100 rounded-3xl flex flex-col items-center justify-center gap-1 text-gray-400 active:scale-95 transition-transform"
          >
            <Camera size={24} />
            <span className="text-[8px] font-bold uppercase">Добавить</span>
          </button>
          <input type="file" ref={carFileRef} hidden accept="image/*" multiple onChange={handleCarPhoto} />
          
          {carPhotos.map((photo, i) => (
            <div key={i} className="relative w-24 h-24 shrink-0 group">
              <img 
                src={photo} 
                className="w-full h-full object-cover rounded-3xl shadow-sm cursor-pointer" 
                onClick={() => setGallery({ images: carPhotos, index: i })}
              />
              <button 
                type="button"
                onClick={() => removeCarPhoto(i)}
                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-1 shadow-md active:scale-90"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Данные авто */}
      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-50 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-1">Марка</label>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full bg-gray-50 p-4 rounded-2xl text-sm font-bold border-none focus:ring-2 focus:ring-gray-100"
            >
              <option value="">Выбрать</option>
              {BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-1">Год</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full bg-gray-50 p-4 rounded-2xl text-sm font-bold border-none focus:ring-2 focus:ring-gray-100"
            >
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-1">Модель</label>
          <input
            placeholder="Напр: Camry 70"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full bg-gray-50 p-4 rounded-2xl text-sm font-bold border-none focus:ring-2 focus:ring-gray-100"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[9px] font-black uppercase tracking-widest text-gray-400 ml-1">VIN номер</label>
          <input
            placeholder="17 символов"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            className="w-full bg-gray-50 p-4 rounded-2xl text-sm font-mono font-bold border-none focus:ring-2 focus:ring-gray-100 uppercase"
          />
        </div>
      </div>

      {/* Данные клиента */}
      <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-50 space-y-4">
        <div className="flex items-center gap-2 mb-2">
           <User size={14} className="text-gray-400" />
           <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Клиент</span>
        </div>
        <div className="grid grid-cols-2 gap-4">
           <input
            placeholder="Имя клиента"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="w-full bg-gray-50 p-4 rounded-2xl text-sm font-bold border-none focus:ring-2 focus:ring-gray-100"
          />
          <div className="relative">
            <Smartphone size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300" />
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
              className="w-full bg-gray-50 p-4 pr-10 rounded-2xl text-sm font-bold border-none focus:ring-2 focus:ring-gray-100 appearance-none"
            >
              {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Добавление деталей */}
      <div className="space-y-4">
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">Запчасти для поиска</label>
        
        <div className="bg-blue-600 p-6 rounded-[32px] shadow-lg shadow-blue-100 space-y-4">
          <input
            placeholder="Название детали..."
            value={partInput}
            onChange={(e) => setPartInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addPart())}
            className="w-full bg-white/10 text-white placeholder:text-blue-200 p-4 rounded-2xl text-sm font-bold border-none focus:ring-2 focus:ring-white/20"
          />
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => partFileRef.current?.click()}
              className="flex-1 bg-white/10 text-white p-4 rounded-2xl flex items-center justify-center gap-2 active:bg-white/20 transition-colors"
            >
              <Camera size={20} />
              <span className="text-xs font-bold uppercase">Фото детали</span>
            </button>
            <input type="file" ref={partFileRef} hidden accept="image/*" multiple onChange={handlePartPhoto} />
            
            <button
              type="button"
              onClick={addPart}
              className="w-14 h-14 bg-white text-blue-600 rounded-2xl flex items-center justify-center shadow-md active:scale-95 transition-transform"
            >
              <Plus size={24} />
            </button>
          </div>

          {partPhotos.length > 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar pt-2">
              {partPhotos.map((photo, i) => (
                <div key={i} className="relative w-16 h-16 shrink-0">
                  <img src={photo} className="w-full h-full object-cover rounded-xl border-2 border-white/20" />
                  <button 
                    type="button"
                    onClick={() => removePartPhoto(i)}
                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Список добавленных деталей */}
        <div className="space-y-2">
          {parts.map((p, i) => (
            <div key={i} className="flex items-center justify-between bg-white p-3 rounded-2xl border border-gray-100 group animate-in slide-in-from-right-2">
              <div className="flex items-center gap-3 overflow-hidden">
                {p.photos.length > 0 ? (
                  <div className="flex -space-x-3 shrink-0">
                      {p.photos.slice(0, 3).map((img, idx) => (
                          <div key={idx} className="w-8 h-8 rounded-lg border-2 border-white overflow-hidden shadow-sm">
                              <img src={img} className="w-full h-full object-cover" />
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

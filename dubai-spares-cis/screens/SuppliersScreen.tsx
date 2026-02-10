import React, { useRef, useState } from 'react';
import { useStore } from '../store';
import { Supplier } from '../types';
import { 
  Search, 
  Phone, 
  MapPin, 
  Store,
  UserPlus,
  Download,
  Upload,
  Trash2,
  Tag,
  CheckCircle2,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import ConfirmModal from '../components/ConfirmModal';
import { resolveCoordinatesFromLocation } from '../mapsLocation';
import { upsertSupplierToShops } from '../radarShops';
import { createUuid } from '../id';

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
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [locationParseNotice, setLocationParseNotice] = useState<string | null>(null);


  const filtered = suppliers.filter(s => {
    const normalized = searchTerm.toLowerCase();
    return s.name.toLowerCase().includes(normalized)
      || s.phone.includes(searchTerm)
      || (s.brands || []).some((b) => b.toLowerCase().includes(normalized))
      || (s.models || []).some((m) => m.toLowerCase().includes(normalized))
      || (s.years || []).some((y) => String(y).includes(searchTerm))
      || (s.bodyTypes || []).some((bodyType) => bodyType.toLowerCase().includes(normalized));
  });


  const buildSupplierFallbackQueries = () => {
    const queries = new Set<string>();

    if (name.trim()) {
      queries.add(name.trim());
      queries.add(`${name.trim()} Dubai`);
      queries.add(`${name.trim()} Sharjah`);
    }

    if (location.trim() && name.trim()) {
      queries.add(`${name.trim()} ${location.trim()}`.trim());
    }

    return Array.from(queries);
  };


  const handleSave = async () => {
    if (!name) return;

    setIsSavingSupplier(true);
    try {
      const coordinates = await resolveCoordinatesFromLocation(location, {
        fallbackQueries: buildSupplierFallbackQueries(),
        onManualLocationRequired: setLocationParseNotice
      });
      const newSupplier: Supplier = {
        id: createUuid(),
        name,
        phone,
        location,
        brands: [],
        models: [],
        years: [],
        bodyTypes: [],
        coordinates
      };

      addSupplier(newSupplier);
      await upsertSupplierToShops(newSupplier);

      setName('');
      setPhone('');
      setLocation('');
      setLocationParseNotice(null);
      setIsAdding(false);
    } finally {
      setIsSavingSupplier(false);
    }
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

  const confirmDeleteSupplier = async () => {
    if (!deleteSupplierId) return;
    await deleteSupplier(deleteSupplierId);
    setDeleteSupplierId(null);
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
          placeholder="Поиск магазина, телефона или локации..."
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
            className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl animate-in zoom-in-95 duration-200 space-y-5 max-h-[92vh] overflow-y-auto" 
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
                  value={location} onChange={e => { setLocation(e.target.value); setLocationParseNotice(null); }}
                  autoComplete="off"
                  className="w-full bg-gray-50 border border-gray-100 p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-base"
                />
              </div>
              {locationParseNotice && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  {locationParseNotice}
                </div>
              )}
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold active:bg-gray-200 transition-colors uppercase text-xs">Отмена</button>
              <button type="submit" disabled={isSavingSupplier} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg active:bg-blue-700 transition-colors uppercase text-xs disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2">{isSavingSupplier ? <><Loader2 size={14} className="animate-spin" /> Поиск координат...</> : 'Добавить'}</button>
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

              {(s.brands.length > 0 || (s.models || []).length > 0 || (s.years || []).length > 0 || (s.bodyTypes || []).length > 0) && (
                <div className="pt-2 flex flex-wrap gap-1.5 border-t border-gray-50">
                  {s.brands.map(b => (
                    <span key={`brand-${b}`} className="bg-gray-50 text-gray-500 text-[9px] font-bold px-2 py-0.5 rounded-md uppercase border border-gray-100 flex items-center gap-1">
                      <Tag size={8} /> {b}
                    </span>
                  ))}
                  {(s.models || []).map((model) => (
                    <span key={`model-${model}`} className="bg-blue-50 text-blue-600 text-[9px] font-bold px-2 py-0.5 rounded-md uppercase border border-blue-100">
                      MODEL: {model}
                    </span>
                  ))}
                  {(s.years || []).map((year) => (
                    <span key={`year-${year}`} className="bg-amber-50 text-amber-700 text-[9px] font-bold px-2 py-0.5 rounded-md uppercase border border-amber-100">
                      YEAR: {year}
                    </span>
                  ))}
                  {(s.bodyTypes || []).map((bodyType) => (
                    <span key={`body-${bodyType}`} className="bg-purple-50 text-purple-700 text-[9px] font-bold px-2 py-0.5 rounded-md uppercase border border-purple-100">
                      BODY: {bodyType}
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

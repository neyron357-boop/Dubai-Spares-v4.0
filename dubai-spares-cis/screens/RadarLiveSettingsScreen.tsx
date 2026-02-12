import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAppSettings } from '../appSettings';

const RadarLiveSettingsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { settings, updateSettings } = useAppSettings();

  return (
    <div className="min-h-full max-w-full overflow-x-hidden bg-gray-50 p-4 pb-24 space-y-4">
      <button type="button" onClick={() => navigate('/settings')} className="inline-flex items-center gap-1 text-sm font-bold text-blue-600">
        <ArrowLeft size={16} /> Назад в Настройки
      </button>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
        <h1 className="text-lg font-black text-gray-900">Radar Live</h1>
        <p className="text-xs text-gray-500">Отдельный экран для параметров карты и GPS.</p>

        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">Default mode</label>
            <select value={settings.radarDefaultMode} onChange={(e) => updateSettings({ radarDefaultMode: e.target.value as 'field' | 'detail' })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2">
              <option value="field">Field</option>
              <option value="detail">Detail</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">Default radius</label>
            <select value={settings.radarDefaultRadiusKm} onChange={(e) => updateSettings({ radarDefaultRadiusKm: Number(e.target.value) as 2 | 5 | 10 | 20 })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2">
              {[2, 5, 10, 20].map((n) => (
                <option key={n} value={n}>{n} km</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">Default filter</label>
            <select value={settings.radarDefaultFilter} onChange={(e) => updateSettings({ radarDefaultFilter: e.target.value as any })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2">
              <option value="all">ALL</option>
              <option value="new_only">NEW_ONLY</option>
              <option value="used_only">USED_ONLY</option>
              <option value="open_now">OPEN NOW</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">GPS interval</label>
            <select value={settings.gpsUpdateInterval} onChange={(e) => updateSettings({ gpsUpdateInterval: e.target.value as any })} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2">
              <option value="10s">10s</option>
              <option value="30s">30s</option>
              <option value="manual">manual</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2">
        <h2 className="text-sm font-black text-gray-900">Переключатели</h2>
        {[
          ['BRAND STRICT', 'radarBrandStrict'],
          ['FALLBACK NEARBY', 'radarFallbackNearby'],
          ['Авто-скрытие HIDE', 'radarAutoHideAfterAction'],
          ['Авто-следующая точка', 'radarAutoNextPoint'],
          ['High accuracy GPS', 'gpsHighAccuracy']
        ].map(([label, key]) => (
          <label key={key} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold">
            <span>{label}</span>
            <input type="checkbox" checked={(settings as any)[key]} onChange={(e) => updateSettings({ [key]: e.target.checked } as any)} />
          </label>
        ))}
      </section>
    </div>
  );
};

export default RadarLiveSettingsScreen;

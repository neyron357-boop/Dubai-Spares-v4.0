import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Wrench } from 'lucide-react';

const SettingsScreen: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-gray-50 p-4 pb-24 space-y-4">
      <div>
        <h1 className="text-xl font-black text-gray-900">Настройки</h1>
        <p className="text-xs text-gray-500 mt-1">Системные параметры и служебные инструменты</p>
      </div>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
        <p className="text-xs font-bold text-amber-700">Раздел для разработчика: только для диагностики.</p>
      </section>

      <button
        type="button"
        onClick={() => navigate('/debug')}
        className="w-full rounded-2xl border border-gray-200 bg-white p-4 flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Wrench size={18} />
          </div>
          <div className="text-left">
            <p className="text-sm font-black text-gray-900">Для разработчика</p>
            <p className="text-xs text-gray-500">Debug / Logs</p>
          </div>
        </div>
        <ChevronRight size={18} className="text-gray-300" />
      </button>
    </div>
  );
};

export default SettingsScreen;

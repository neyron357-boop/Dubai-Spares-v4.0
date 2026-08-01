import React from 'react';
import { useNavigate } from 'react-router-dom';

const NotFoundScreen: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-full bg-gray-50 p-6 flex items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">404</p>
        <h1 className="text-xl font-black text-slate-900">Страница не найдена</h1>
        <p className="text-sm text-slate-600">Проверьте ссылку или вернитесь на главный экран.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="w-full rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase text-white"
        >
          Вернуться на главную
        </button>
      </div>
    </div>
  );
};

export default NotFoundScreen;

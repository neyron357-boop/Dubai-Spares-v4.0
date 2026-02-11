import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { AppNotification, getNotifications, markAllNotificationsRead, markNotificationRead } from '../notificationCenter';

const NotificationsScreen: React.FC = () => {
  const [notifications, setNotifications] = useState<AppNotification[]>(() => getNotifications());
  const navigate = useNavigate();

  useEffect(() => {
    const update = () => setNotifications(getNotifications());
    window.addEventListener('notifications:changed', update);
    return () => window.removeEventListener('notifications:changed', update);
  }, []);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  return (
    <div className="p-4 space-y-4 pb-20 overflow-x-hidden bg-gray-50 min-h-full">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-black text-gray-900">Уведомления</h1>
        <button type="button" onClick={markAllNotificationsRead} className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-[11px] font-black uppercase text-gray-600">
          <CheckCheck size={14} /> Прочитано
        </button>
      </div>
      <div className="rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700">Непрочитанных: {unreadCount}</div>

      {notifications.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white py-16 text-center text-xs font-black uppercase tracking-widest text-gray-300">
          Пока пусто
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                markNotificationRead(item.id);
                if (item.route) navigate(item.route);
              }}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition-all ${item.read ? 'bg-white border-gray-100' : 'bg-indigo-50 border-indigo-100'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-black text-gray-900 truncate">{item.title}</p>
                  <p className="mt-1 text-xs text-gray-600 leading-relaxed">{(item.body || '').slice(0, 90)}{(item.body || '').length > 90 ? '…' : ''}</p>
                  <p className="mt-2 text-[10px] font-bold uppercase text-gray-400">{new Date(item.createdAt).toLocaleString()}</p>
                  <div className="mt-2 flex gap-2">
                    <span className="inline-flex h-8 items-center rounded-lg bg-blue-600 px-2 text-[10px] font-black uppercase text-white">Открыть заказ</span>
                    {item.body?.includes('http') && <span className="inline-flex h-8 items-center rounded-lg bg-emerald-50 px-2 text-[10px] font-black uppercase text-emerald-700">Открыть карту</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-gray-300 shrink-0">
                  {!item.read && <Bell size={14} className="text-indigo-500" />}
                  <ChevronRight size={16} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default NotificationsScreen;

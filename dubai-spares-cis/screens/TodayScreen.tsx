import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Boxes, Lightbulb, Settings, ShoppingBag, Store } from 'lucide-react';

type HomeMenuItem = {
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
};

const TodayScreen: React.FC = () => {
  const navigate = useNavigate();

  const menuItems: HomeMenuItem[] = [
    {
      label: 'Vendors',
      description: 'Слайдер поставщиков и витрина',
      path: '/vendor/slider',
      icon: <Store size={20} />,
    },
    {
      label: 'Lights',
      description: 'Раздел с вариантами и товарами',
      path: '/variants',
      icon: <Lightbulb size={20} />,
    },
    {
      label: 'Оповещения',
      description: 'Проверить новые уведомления',
      path: '/notifications',
      icon: <Bell size={20} />,
    },
    {
      label: 'Настройки',
      description: 'Конфигурация приложения',
      path: '/settings',
      icon: <Settings size={20} />,
    },
    {
      label: 'Поставщики',
      description: 'База поставщиков и каталоги',
      path: '/database',
      icon: <ShoppingBag size={20} />,
    },
    {
      label: 'Заказы',
      description: 'Перейти к активным заказам',
      path: '/orders',
      icon: <Boxes size={20} />,
    },
  ];

  return (
    <div className="min-h-full bg-[#121212] text-center px-6 py-10 text-white">
      <div className="space-y-4 mb-8">
        <div className="text-6xl">🚧</div>
        <h1 className="text-2xl font-black">В разработке</h1>
        <p className="text-gray-400 text-sm">Этот раздел находится в разработке.<br />Пока можно перейти в другие разделы приложения.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 text-left">
        {menuItems.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => navigate(item.path)}
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 hover:bg-white/10 active:bg-white/15 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="mt-1 text-blue-300">{item.icon}</span>
              <span>
                <span className="block text-sm font-black">{item.label}</span>
                <span className="block text-xs text-gray-400 mt-1">{item.description}</span>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TodayScreen;

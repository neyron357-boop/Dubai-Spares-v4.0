import React from 'react';
import { useDrawer } from '../DrawerContext';
import { Bell, Layers, Menu, Settings, ShoppingBag } from 'lucide-react';

type HomeMenuItem = {
  label: string;
  description: string;
  onClick: () => void;
  icon: React.ReactNode;
};

const TodayScreen: React.FC = () => {
  const { openMenu } = useDrawer();

  const menuItems: HomeMenuItem[] = [
    {
      label: 'Vendor Slides',
      description: 'Слайдер поставщиков и витрина',
      onClick: openMenu,
      icon: <Layers size={20} />,
    },
    {
      label: 'Оповещения',
      description: 'Проверить новые уведомления',
      onClick: openMenu,
      icon: <Bell size={20} />,
    },
    {
      label: 'Настройки',
      description: 'Конфигурация приложения',
      onClick: openMenu,
      icon: <Settings size={20} />,
    },
    {
      label: 'Поставщики',
      description: 'База поставщиков и каталоги',
      onClick: openMenu,
      icon: <ShoppingBag size={20} />,
    },
  ];

  return (
    <div className="min-h-full bg-[#121212] text-center px-6 py-10 text-white">
      <div className="space-y-4 mb-8">
        <div className="text-6xl">🚧</div>
        <h1 className="text-2xl font-black">В разработке</h1>
        <p className="text-gray-400 text-sm">Этот раздел находится в разработке.<br />Используйте меню для навигации.</p>
        <button
          type="button"
          onClick={openMenu}
          className="inline-flex items-center gap-2 mx-auto rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/15 active:bg-white/20 transition-colors"
        >
          <Menu size={18} />
          Открыть меню
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 text-left">
        {menuItems.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
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

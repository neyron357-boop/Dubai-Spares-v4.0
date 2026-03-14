import React from 'react';

const TodayScreen: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-[#121212] text-center px-6">
      <div className="space-y-4">
        <div className="text-6xl">🚧</div>
        <h1 className="text-2xl font-black text-white">В разработке</h1>
        <p className="text-gray-400 text-sm">Этот раздел находится в разработке.<br />Скоро здесь появится что-то интересное.</p>
      </div>
    </div>
  );
};

export default TodayScreen;

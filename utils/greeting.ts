export const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 4 && hour < 11) return 'Доброе утро, Ахмад! ☀️';
  if (hour >= 11 && hour < 17) return 'Добрый день!';
  return 'Добрый вечер!';
};

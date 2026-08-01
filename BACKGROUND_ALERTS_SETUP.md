# 24/7 фоновые уведомления и звук (лиды + радар)

Текущий проект — веб/PWA. На iOS/Android браузер **не гарантирует** непрерывный звук 24/7 в фоне и при блокировке экрана.

Чтобы реализовать требования надежно, нужен нативный контейнер:

## Рекомендуемый стек
- React Native + Expo (или чистый RN)
- Firebase Cloud Messaging (FCM) для Android
- APNs для iOS
- Background geolocation сервис:
  - `react-native-background-geolocation` (Transistorsoft) или аналог
- Локальные уведомления:
  - `@react-native-firebase/messaging`
  - `notifee`

## Что включить
1. **Foreground service (Android)** для непрерывной геолокации.
2. **Exact alarms / high-priority notifications** (Android 12+).
3. **Critical Alerts / Time Sensitive** (iOS, при одобрении capability).
4. Канал уведомлений `leads_critical` с custom sound.
5. Канал уведомлений `radar_proximity` с custom sound.
6. Серверный webhook из формы клиента -> пуш в FCM/APNs.

## Backend-пайплайн лидов
1. Форма клиента сохраняет заявку в БД.
2. Триггер/edge function вызывает сервис push.
3. Отправка high-priority push:
   - type: `lead_new`
   - sound: `lead_alarm`
   - collapse_key: `lead_<id>`
4. На устройстве приложение показывает heads-up уведомление + звук.

## Radar proximity (100–200 м)
1. Фоновый GPS каждые 5–10 сек.
2. Геофенс вокруг рекомендованных поставщиков (радиус 200 м, warning 300 м).
3. При входе в 200 м: звук + push + вибрация.
4. Debounce/anti-spam: повтор не чаще 1 раза в 10–15 мин на поставщика.

## Минимальные разрешения
- Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `POST_NOTIFICATIONS`, `WAKE_LOCK`.
- iOS: `location always`, background modes: `location updates`, `remote notifications`.

## Важно
Без нативного слоя и системных разрешений мобильной ОС требование "24/7 со звуком даже при блокировке" в веб-режиме недостижимо.

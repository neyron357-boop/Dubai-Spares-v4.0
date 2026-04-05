# Local-first хранение для мобильного веб-приложения (iPhone Safari)

## 1) Цели и ограничения

- **Полностью локальная архитектура**: без сервера, без облака, без нативных плагинов.
- **Основное хранилище**: `IndexedDB`.
- **Резервное копирование обязательно**: данные Safari могут быть удалены при очистке браузера/кэша.
- **Ручной цикл безопасности данных**: Export backup → хранение файла пользователем → Import при восстановлении.

## 2) Минимальная структура IndexedDB

- DB name: `dubai-spares-local`
- DB version: `1` (с миграциями при изменениях)

### Stores

1. `orders`
2. `parts`
3. `priceVariants`
4. `suppliers`
5. `photos`
6. `photoLinks` (связь фотографий с заказом/деталью)
7. `meta` (служебные данные: версия схемы, время последнего backup)

## 3) Схема сущностей и ключи

> Все ключи строковые (`id: string`, лучше `crypto.randomUUID()`).

### `orders`

```ts
{
  id: string;
  createdAt: string;      // ISO
  updatedAt: string;      // ISO
  customerName?: string;
  customerPhone?: string;
  carBrand?: string;
  carModel?: string;
  vin?: string;
  status: 'new' | 'in_progress' | 'done' | 'canceled';
  note?: string;
}
```

Индексы:
- `by_updatedAt` → `updatedAt`
- `by_status` → `status`

### `parts`

```ts
{
  id: string;
  orderId: string;        // FK -> orders.id
  name: string;
  oemNumber?: string;
  qty: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}
```

Индексы:
- `by_orderId` → `orderId`
- `by_updatedAt` → `updatedAt`

### `priceVariants`

```ts
{
  id: string;
  partId: string;         // FK -> parts.id
  supplierId?: string;    // FK -> suppliers.id
  price: number;
  currency: 'AED' | 'USD' | 'EUR';
  deliveryDays?: number;
  condition?: 'new' | 'used';
  note?: string;
  createdAt: string;
  updatedAt: string;
}
```

Индексы:
- `by_partId` → `partId`
- `by_supplierId` → `supplierId`
- `by_updatedAt` → `updatedAt`

### `suppliers`

```ts
{
  id: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  city?: string;
  rating?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}
```

Индексы:
- `by_name` → `name`
- `by_updatedAt` → `updatedAt`

### `photos`

```ts
{
  id: string;
  mimeType: 'image/jpeg' | 'image/webp';
  blob: Blob;             // бинарные данные фото
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
}
```

Индексы:
- `by_createdAt` → `createdAt`

### `photoLinks`

```ts
{
  id: string;
  photoId: string;        // FK -> photos.id
  entityType: 'order' | 'part';
  entityId: string;       // orders.id или parts.id
  label?: string;
  createdAt: string;
}
```

Индексы:
- `by_photoId` → `photoId`
- `by_entity` → `[entityType, entityId]`

### `meta`

```ts
{
  key: string;            // 'schemaVersion' | 'lastBackupAt' | ...
  value: unknown;
}
```

## 4) Связи между сущностями

- `orders (1) -> (N) parts`
- `parts (1) -> (N) priceVariants`
- `suppliers (1) -> (N) priceVariants`
- `orders/parts (1) -> (N) photoLinks`
- `photoLinks (N) -> (1) photos`

### Правила целостности (в коде репозитория)

- При удалении заказа:
  - удалить его `parts`;
  - удалить `priceVariants` этих деталей;
  - удалить связанные `photoLinks`;
  - удалить неиспользуемые `photos` (если больше нет ссылок).
- При удалении детали:
  - удалить её `priceVariants` и `photoLinks`;
  - cleanup orphan `photos`.
- Проверки FK делаются в сервисном слое (IndexedDB не проверяет FK автоматически).

## 5) Формат backup-файла

Формат: **один JSON-файл** (простой и переносимый).

```json
{
  "backupVersion": 1,
  "app": "dubai-spares-local",
  "createdAt": "2026-04-05T12:00:00.000Z",
  "schemaVersion": 1,
  "data": {
    "orders": [],
    "parts": [],
    "priceVariants": [],
    "suppliers": [],
    "photos": [],
    "photoLinks": [],
    "meta": []
  }
}
```

### Как хранить фото внутри backup

У поля `photos` хранить не `Blob`, а base64-представление:

```ts
{
  id: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: string;
  base64: string; // data без префикса data:image/...;base64,
}
```

Это увеличит размер backup примерно на 25–35%, но позволяет полностью восстановить данные без внешних файлов.

## 6) Логика Export

1. Открыть read-only транзакции по всем stores.
2. Вычитать все записи (`getAll`).
3. Для `photos.blob` выполнить конвертацию `Blob -> base64`.
4. Сформировать объект backup с `backupVersion` и `schemaVersion`.
5. `JSON.stringify` и предложить скачать файл:
   - имя: `dubai-spares-backup-YYYY-MM-DD.json`
6. Обновить `meta.lastBackupAt`.

Ключевой принцип надежности: export выполняется **явным действием пользователя** (кнопка «Скачать backup»).

## 7) Логика Import (полное восстановление)

1. Пользователь выбирает backup-файл.
2. Валидация:
   - валидный JSON;
   - `backupVersion` поддерживается;
   - обязательные store-ключи присутствуют.
3. Предпросмотр: показать кол-во записей по каждому store.
4. Подтверждение пользователя: «Полностью перезаписать локальные данные?»
5. Транзакция `readwrite` по всем stores:
   - очистить stores;
   - вставить данные из backup;
   - `base64 -> Blob` для `photos`.
6. Пост-валидация:
   - проверка количества записей;
   - проверка FK-связей (например, `part.orderId` существует).
7. Записать `meta.lastRestoreAt`.

Если импорт падает — транзакция откатывается, частично поврежденное состояние не сохраняется.

## 8) Минимальная архитектура для фото

### Поток добавления фото

1. Пользователь выбирает фото (`<input type="file" accept="image/*" capture="environment">`).
2. Перед сохранением выполнить ресайз/сжатие в `canvas`.
3. Сохранить в `photos` как `Blob` (`jpeg/webp`).
4. Создать запись связи в `photoLinks`.

### Отображение фото

- Получить `Blob` из `photos`.
- Создать `URL.createObjectURL(blob)`.
- После использования вызывать `URL.revokeObjectURL(url)`.

## 9) Рекомендации по сжатию и лимитам

Для iPhone/Safari приоритизировать размер, чтобы не упираться в квоты браузера:

- Макс. размер стороны: `1600 px` (для обычных фото деталей).
- Формат: `image/jpeg` (или `image/webp`, если стабильно поддержан в целевом окружении).
- Качество JPEG: `0.72–0.82`.
- Цель размера: `150–400 KB` на фото.
- Ограничение на фото: например, `до 10–20 фото на заказ` (зависит от сценария).
- Порог предупреждения хранилища: при оценке > 70% доступного места просить пользователя сделать backup и удалить лишние фото.

## 10) Простая реализация по слоям

1. `db.ts`
   - open/upgrade IndexedDB
   - создание stores + indexes
2. `repositories/*`
   - CRUD для каждой сущности
   - batch-операции удаления каскадов
3. `photoService.ts`
   - resize/compress
   - blob/base64 конвертация
4. `backupService.ts`
   - `exportBackup()`
   - `importBackup(file)`
   - validate + statistics
5. `integrityService.ts`
   - проверки FK и orphan cleanup

Без тяжелых библиотек; использовать нативные Web API.

## 11) Пошаговый план внедрения (без лишней сложности)

1. Реализовать `db.ts` и stores (v1).
2. Подключить репозитории `orders/parts/priceVariants/suppliers`.
3. Добавить `photos + photoLinks` с компрессией перед записью.
4. Сделать кнопку **Export backup** и протестировать восстановление на чистом профиле Safari.
5. Сделать **Import backup** с полным перезаписыванием.
6. Добавить пост-валидацию связей и orphan-cleanup.
7. Добавить UX-напоминание: «Сделайте backup» (например, раз в N дней или после X изменений).

## 12) Надежность и эксплуатация

- Данные в IndexedDB = рабочее локальное состояние.
- Backup-файл = единственный гарантированный способ восстановления после очистки браузера/переустановки/смены устройства.
- Рекомендуемая практика: 
  - перед крупными изменениями — сделать backup;
  - периодически выгружать backup в «Файлы»/iCloud Drive вручную.

---

Этот дизайн соответствует требованиям: чистая веб-архитектура, локальная работа на iPhone, IndexedDB как основа, фото внутри IndexedDB, полный export/import без сервера.

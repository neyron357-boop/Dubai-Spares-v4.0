// types.ts

export enum Priority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
}

export enum Source {
  INSTAGRAM = "Instagram",
  TIKTOK = "TikTok",
  FACEBOOK = "Facebook",
  TELEGRAM = "Telegram",
  WHATSAPP = "WhatsApp",
  OTHER = "Другое",
}

/**
 * Унифицированный тип для фоток (URL строками)
 */
export type PhotoUrl = string;

/**
 * Контакты магазина/поставщика (вынесено отдельно, чтобы не дублировать и
 * чтобы удобно типизировать автозаполнение).
 */
export interface ShopContact {
  shopName: string;
  phone: string;
  location: string; // может быть текст/ссылка/координаты
}

/**
 * Вариант цены по детали
 */
export interface PriceVariant extends ShopContact {
  id: string;
  priceAed: number;

  // Legacy/compat:
  photoUrl?: PhotoUrl; // Deprecated, use photos
  photos?: PhotoUrl[]; // New

  createdAt: number;
}

/**
 * Деталь в заказе
 */
export interface Part {
  id: string;
  name: string;

  // Legacy/compat:
  photoUrl?: PhotoUrl; // Deprecated, use photos
  photos?: PhotoUrl[]; // New

  variants: PriceVariant[];
  isFound: boolean;
}

/**
 * Заказ
 */
export interface Order {
  id: string;
  brand: string;
  model: string;
  year: string;
  vin: string;

  priority: Priority;

  clientName: string;
  source: Source;

  // Legacy/compat:
  carPhotoUrl?: PhotoUrl; // Deprecated, use carPhotos
  carPhotos?: PhotoUrl[]; // New

  parts: Part[];

  // Финансы
  markupPercent: number;   // наценка %
  exchangeRate: number;    // курс AED->USD (пример: 3.67)

  createdAt: number;

  // Статусы
  isArchived: boolean;
  isSold: boolean;
  soldProfitUsd?: number;
}

/**
 * Поставщик (база)
 */
export interface Supplier extends ShopContact {
  id: string;

  // brands можно сделать readonly, чтобы не было случайных мутаций
  brands: string[];

  // Legacy/compat:
  photoUrl?: PhotoUrl;
  photos?: PhotoUrl[];
}

/**
 * Удобные алиасы, чтобы НЕ ловить never[] в коде:
 * - используйте их в useState<OrdersState>(...)
 */
export type OrdersState = Order[];
export type PartsState = Part[];
export type VariantsState = PriceVariant[];
export type SuppliersState = Supplier[];

/**
 * Дефолтные значения (необязательно, но супер полезно)
 */
export const DEFAULT_EXCHANGE_RATE = 3.67;
export const DEFAULT_MARKUP_PERCENT = 15;

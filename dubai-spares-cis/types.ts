export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH'
}

export enum Source {
  INSTAGRAM = 'Instagram',
  TIKTOK = 'TikTok',
  FACEBOOK = 'Facebook',
  TELEGRAM = 'Telegram',
  WHATSAPP = 'WhatsApp',
  OTHER = 'Другое'
}

export interface PriceVariant {
  id: string;
  priceAed: number;
  shopName: string;
  phone: string;
  location: string;
  photoUrl?: string; // Deprecated, use photos
  photos?: string[]; // New
  createdAt: number;
}

export interface Part {
  id: string;
  name: string;
  photoUrl?: string; // Deprecated, use photos
  photos?: string[]; // New
  variants: PriceVariant[];
  isFound: boolean;
}

export interface OrderNote {
  id: string;
  text: string;
  photos: string[];
  createdAt: number;
}

export interface Order {
  id: string;
  brand: string;
  model: string;
  year: string;
  vin: string;
  priority: Priority;
  clientName: string;
  source: Source;
  carPhotoUrl?: string; // Deprecated, use carPhotos
  carPhotos?: string[]; // New
  parts: Part[];
  notes?: OrderNote[];
  isPinned?: boolean;
  isVip?: boolean;
  markupPercent: number;
  exchangeRate: number;
  createdAt: number;
  isArchived: boolean;
  isSold: boolean;
  soldProfitUsd?: number; 
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  location: string;
  brands: string[];
  photoUrl?: string;
  photos?: string[];
}

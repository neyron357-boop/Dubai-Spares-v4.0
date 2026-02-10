import { Source } from './types';

export const BRANDS = [
  'Toyota', 'Lexus', 'Nissan', 'Infiniti', 'Mitsubishi', 'Honda', 'Mazda', 'Subaru',
  'Mercedes-Benz', 'BMW', 'Audi', 'Porsche', 'Volkswagen', 'Land Rover', 'Jaguar',
  'Ford', 'Chevrolet', 'Jeep', 'Dodge', 'Hyundai', 'Kia', 'Tesla'
].sort();

export const SOURCES = Object.values(Source);

export const SOCIAL_SOURCES: Source[] = [
  Source.INSTAGRAM,
  Source.FACEBOOK,
  Source.TELEGRAM,
  Source.WHATSAPP,
  Source.TIKTOK
];

export const BRAND_MODELS: Record<string, string[]> = {
  Toyota: ['Camry', 'Corolla', 'Land Cruiser', 'Prado', 'RAV4', 'Yaris', 'Hilux'],
  Lexus: ['ES', 'GS', 'IS', 'LX', 'RX', 'NX'],
  Nissan: ['Patrol', 'Altima', 'Sunny', 'X-Trail', 'Pathfinder'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'S-Class', 'GLE', 'GLS', 'G-Class'],
  BMW: ['3 Series', '5 Series', '7 Series', 'X3', 'X5', 'X7'],
  Honda: ['Accord', 'Civic', 'CR-V', 'Pilot'],
  Hyundai: ['Elantra', 'Sonata', 'Tucson', 'Santa Fe'],
  Kia: ['K5', 'Sportage', 'Sorento', 'Cerato'],
  Ford: ['Explorer', 'Edge', 'F-150', 'Mustang'],
  Chevrolet: ['Tahoe', 'Suburban', 'Malibu', 'Captiva']
};

export const YEARS = Array.from({ length: 30 }, (_, i) => (new Date().getFullYear() - i).toString());

export const DEFAULT_MARKUP = 15;
export const DEFAULT_RATE = 3.67;

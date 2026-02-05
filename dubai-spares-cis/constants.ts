import { Source } from './types';

export const BRANDS = [
  'Toyota', 'Lexus', 'Nissan', 'Infiniti', 'Mitsubishi', 'Honda', 'Mazda', 'Subaru',
  'Mercedes-Benz', 'BMW', 'Audi', 'Porsche', 'Volkswagen', 'Land Rover', 'Jaguar',
  'Ford', 'Chevrolet', 'Jeep', 'Dodge', 'Hyundai', 'Kia', 'Tesla'
].sort();

export const SOURCES = Object.values(Source);

export const YEARS = Array.from({ length: 30 }, (_, i) => (new Date().getFullYear() - i).toString());

export const DEFAULT_MARKUP = 15;
export const DEFAULT_RATE = 3.67;

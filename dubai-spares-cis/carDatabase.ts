export interface CarBrandCatalog {
  models: string[];
  bodyTypes: string[];
}

export const CAR_DATABASE: Record<string, CarBrandCatalog> = {
  Acura: { models: ['ILX', 'Integra', 'MDX', 'NSX', 'RDX', 'RLX', 'TLX', 'ZDX'], bodyTypes: ['Sedan', 'SUV', 'Coupe'] },
  'Alfa Romeo': { models: ['4C', 'Giulia', 'Giulietta', 'Stelvio', 'Tonale'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Coupe'] },
  Audi: { models: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'RS3', 'RS4', 'RS5', 'RS6', 'RS7', 'TT', 'R8', 'e-tron'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback', 'Wagon', 'Convertible'] },
  Bentley: { models: ['Bentayga', 'Continental GT', 'Flying Spur', 'Mulsanne'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Convertible'] },
  BMW: { models: ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', '8 Series', 'i3', 'i4', 'i5', 'i7', 'i8', 'iX', 'iX1', 'iX3', 'M2', 'M3', 'M4', 'M5', 'M8', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'XM', 'Z4'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback', 'Wagon', 'Convertible', 'E30', 'E34', 'E36', 'E38', 'E39', 'E46', 'E53', 'E60', 'E65', 'E70', 'E71', 'E82', 'E83', 'E87', 'E90', 'E91', 'E92', 'E93', 'F10', 'F15', 'F20', 'F22', 'F25', 'F30', 'F32', 'G20', 'G30'] },
  Cadillac: { models: ['ATS', 'CT4', 'CT5', 'Escalade', 'LYRIQ', 'XT4', 'XT5', 'XT6'], bodyTypes: ['Sedan', 'SUV'] },
  Changan: { models: ['Alsvin', 'CS35 Plus', 'CS55 Plus', 'CS75 Plus', 'UNI-K', 'UNI-T'], bodyTypes: ['Sedan', 'SUV'] },
  Chery: { models: ['Arrizo 5', 'Arrizo 8', 'Tiggo 2', 'Tiggo 4', 'Tiggo 7', 'Tiggo 8'], bodyTypes: ['Sedan', 'SUV'] },
  Chevrolet: { models: ['Aveo', 'Camaro', 'Captiva', 'Cruze', 'Equinox', 'Impala', 'Malibu', 'Silverado', 'Suburban', 'Tahoe', 'Trailblazer'], bodyTypes: ['Sedan', 'SUV', 'Pickup', 'Coupe'] },
  Citroen: { models: ['C3', 'C4', 'C5 Aircross', 'Berlingo'], bodyTypes: ['Hatchback', 'SUV', 'Van'] },
  Dodge: { models: ['Challenger', 'Charger', 'Durango', 'Journey', 'RAM 1500'], bodyTypes: ['Sedan', 'SUV', 'Pickup', 'Coupe'] },
  Ferrari: { models: ['296 GTB', '812 Superfast', 'F8 Tributo', 'Purosangue', 'Roma', 'SF90 Stradale'], bodyTypes: ['Coupe', 'Convertible', 'SUV'] },
  Ford: { models: ['Bronco', 'EcoSport', 'Edge', 'Escape', 'Everest', 'Explorer', 'Expedition', 'F-150', 'Focus', 'Fusion', 'Mustang', 'Ranger', 'Taurus'], bodyTypes: ['Sedan', 'SUV', 'Pickup', 'Coupe', 'Hatchback'] },
  Geely: { models: ['Coolray', 'Emgrand', 'Monjaro', 'Okavango', 'Tugella'], bodyTypes: ['Sedan', 'SUV'] },
  Genesis: { models: ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80'], bodyTypes: ['Sedan', 'SUV'] },
  GMC: { models: ['Acadia', 'Canyon', 'Sierra', 'Terrain', 'Yukon'], bodyTypes: ['SUV', 'Pickup'] },
  Haval: { models: ['Dargo', 'H6', 'H9', 'Jolion'], bodyTypes: ['SUV'] },
  Honda: { models: ['Accord', 'City', 'Civic', 'CR-V', 'HR-V', 'Odyssey', 'Pilot'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'MPV'] },
  Hyundai: { models: ['Accent', 'Elantra', 'Kona', 'Palisade', 'Santa Fe', 'Sonata', 'Tucson'], bodyTypes: ['Sedan', 'SUV', 'Hatchback'] },
  Infiniti: { models: ['Q50', 'Q60', 'QX50', 'QX55', 'QX60', 'QX80'], bodyTypes: ['Sedan', 'SUV', 'Coupe'] },
  Isuzu: { models: ['D-Max', 'MU-X'], bodyTypes: ['Pickup', 'SUV'] },
  Jaguar: { models: ['E-PACE', 'F-PACE', 'F-TYPE', 'I-PACE', 'XE', 'XF', 'XJ'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Convertible'] },
  Jeep: { models: ['Cherokee', 'Compass', 'Gladiator', 'Grand Cherokee', 'Renegade', 'Wrangler'], bodyTypes: ['SUV', 'Pickup'] },
  Kia: { models: ['Carnival', 'Cerato', 'K5', 'Seltos', 'Sorento', 'Sportage', 'Stinger'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'MPV'] },
  'Land Rover': { models: ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar'], bodyTypes: ['SUV'] },
  Lexus: { models: ['CT', 'ES', 'GS', 'GX', 'IS', 'LC', 'LS', 'LX', 'NX', 'RC', 'RX', 'UX'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback'] },
  Lincoln: { models: ['Aviator', 'Corsair', 'Nautilus', 'Navigator'], bodyTypes: ['SUV'] },
  Maserati: { models: ['Ghibli', 'Grecale', 'GranTurismo', 'Levante', 'MC20', 'Quattroporte'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Convertible'] },
  Mazda: { models: ['2', '3', '6', 'CX-3', 'CX-30', 'CX-5', 'CX-9', 'MX-5'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Convertible'] },
  'Mercedes-Benz': { models: ['A-Class', 'B-Class', 'C-Class', 'CLA', 'CLS', 'E-Class', 'G-Class', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'S-Class', 'V-Class', 'AMG GT'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback', 'Van'] },
  MG: { models: ['5', '6', 'GT', 'HS', 'One', 'RX5', 'ZS'], bodyTypes: ['Sedan', 'SUV', 'Hatchback'] },
  Mini: { models: ['Clubman', 'Cooper', 'Countryman'], bodyTypes: ['Hatchback', 'SUV', 'Convertible'] },
  Mitsubishi: { models: ['ASX', 'Eclipse Cross', 'L200', 'Montero', 'Outlander', 'Pajero', 'Xpander'], bodyTypes: ['SUV', 'Pickup', 'MPV'] },
  Nissan: { models: ['Altima', 'Maxima', 'Micra', 'Pathfinder', 'Patrol', 'Sunny', 'X-Trail', 'Z'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Coupe'] },
  Opel: { models: ['Astra', 'Crossland', 'Grandland', 'Insignia', 'Mokka'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Wagon'] },
  Peugeot: { models: ['208', '3008', '408', '5008', 'Partner'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Van'] },
  Porsche: { models: ['718 Boxster', '718 Cayman', '911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Convertible'] },
  Ram: { models: ['1500', '2500', 'TRX'], bodyTypes: ['Pickup'] },
  Renault: { models: ['Arkana', 'Duster', 'Koleos', 'Logan', 'Megane'], bodyTypes: ['Sedan', 'SUV', 'Hatchback'] },
  'Rolls-Royce': { models: ['Cullinan', 'Ghost', 'Phantom', 'Spectre', 'Wraith'], bodyTypes: ['Sedan', 'SUV', 'Coupe'] },
  Seat: { models: ['Ateca', 'Ibiza', 'Leon', 'Tarraco'], bodyTypes: ['SUV', 'Hatchback', 'Sedan'] },
  Skoda: { models: ['Fabia', 'Kamiq', 'Kodiaq', 'Octavia', 'Superb'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Wagon'] },
  Subaru: { models: ['BRZ', 'Forester', 'Impreza', 'Legacy', 'Outback', 'WRX', 'XV'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Wagon', 'Coupe'] },
  Suzuki: { models: ['Baleno', 'Ciaz', 'Jimny', 'Swift', 'Vitara'], bodyTypes: ['Sedan', 'SUV', 'Hatchback'] },
  Tesla: { models: ['Model 3', 'Model S', 'Model X', 'Model Y', 'Cybertruck'], bodyTypes: ['Sedan', 'SUV', 'Pickup'] },
  Toyota: { models: ['4Runner', 'Avalon', 'Camry', 'Corolla', 'Fortuner', 'Hilux', 'Highlander', 'Land Cruiser', 'Prado', 'Prius', 'RAV4', 'Supra', 'Yaris'], bodyTypes: ['Sedan', 'SUV', 'Pickup', 'Hatchback', 'Coupe'] },
  Volvo: { models: ['C40', 'S60', 'S90', 'V60', 'V90', 'XC40', 'XC60', 'XC90'], bodyTypes: ['Sedan', 'SUV', 'Wagon'] },
  Volkswagen: { models: ['Arteon', 'Atlas', 'Golf', 'ID.4', 'Jetta', 'Passat', 'Polo', 'Tiguan', 'Touareg'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Wagon'] }
};

const GENERIC_BODY_TYPES = new Set([
  'sedan',
  'suv',
  'coupe',
  'hatchback',
  'wagon',
  'pickup',
  'convertible',
  'van',
  'mpv'
]);

const isChassisBodyType = (value: string) => !GENERIC_BODY_TYPES.has(value.trim().toLowerCase());

export const CHASSIS_BODY_TYPES_BY_BRAND: Record<string, string[]> = Object.fromEntries(
  Object.entries(CAR_DATABASE).map(([brand, catalog]) => [
    brand,
    catalog.bodyTypes.filter(isChassisBodyType)
  ])
);

export const CAR_BODY_TYPES = Array.from(
  new Set(Object.values(CHASSIS_BODY_TYPES_BY_BRAND).flat())
).sort((a, b) => a.localeCompare(b));

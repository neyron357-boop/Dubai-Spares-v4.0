export interface CarBrandCatalog {
  models: string[];
  bodyTypes: string[];
}

export const CAR_DATABASE: Record<string, CarBrandCatalog> = {
  Audi: { models: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'RS3', 'RS4', 'RS5', 'RS6', 'RS7', 'TT', 'R8', 'e-tron'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback', 'Wagon', 'Convertible'] },
  BMW: { models: ['1 Series', '2 Series', '3 Series', '4 Series', '5 Series', '6 Series', '7 Series', '8 Series', 'i3', 'i4', 'i5', 'i7', 'i8', 'iX', 'iX1', 'iX3', 'M2', 'M3', 'M4', 'M5', 'M8', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'XM', 'Z4'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback', 'Wagon', 'Convertible', 'E30', 'E34', 'E36', 'E38', 'E39', 'E46', 'E53', 'E60', 'E65', 'E70', 'E71', 'E82', 'E83', 'E87', 'E90', 'E91', 'E92', 'E93', 'F10', 'F15', 'F20', 'F22', 'F25', 'F30', 'F32', 'G20', 'G30'] },
  Chevrolet: { models: ['Aveo', 'Camaro', 'Captiva', 'Cruze', 'Equinox', 'Impala', 'Malibu', 'Silverado', 'Suburban', 'Tahoe', 'Trailblazer'], bodyTypes: ['Sedan', 'SUV', 'Pickup', 'Coupe'] },
  Ford: { models: ['Bronco', 'EcoSport', 'Edge', 'Escape', 'Everest', 'Explorer', 'Expedition', 'F-150', 'Focus', 'Fusion', 'Mustang', 'Ranger', 'Taurus'], bodyTypes: ['Sedan', 'SUV', 'Pickup', 'Coupe', 'Hatchback'] },
  Honda: { models: ['Accord', 'City', 'Civic', 'CR-V', 'HR-V', 'Odyssey', 'Pilot'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'MPV'] },
  Hyundai: { models: ['Accent', 'Elantra', 'Kona', 'Palisade', 'Santa Fe', 'Sonata', 'Tucson'], bodyTypes: ['Sedan', 'SUV', 'Hatchback'] },
  Infiniti: { models: ['Q50', 'Q60', 'QX50', 'QX55', 'QX60', 'QX80'], bodyTypes: ['Sedan', 'SUV', 'Coupe'] },
  Jaguar: { models: ['E-PACE', 'F-PACE', 'F-TYPE', 'I-PACE', 'XE', 'XF', 'XJ'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Convertible'] },
  Jeep: { models: ['Cherokee', 'Compass', 'Gladiator', 'Grand Cherokee', 'Renegade', 'Wrangler'], bodyTypes: ['SUV', 'Pickup'] },
  Kia: { models: ['Carnival', 'Cerato', 'K5', 'Seltos', 'Sorento', 'Sportage', 'Stinger'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'MPV'] },
  'Land Rover': { models: ['Defender', 'Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Evoque', 'Range Rover Sport', 'Range Rover Velar'], bodyTypes: ['SUV'] },
  Lexus: { models: ['CT', 'ES', 'GS', 'GX', 'IS', 'LC', 'LS', 'LX', 'NX', 'RC', 'RX', 'UX'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback'] },
  Mazda: { models: ['2', '3', '6', 'CX-3', 'CX-30', 'CX-5', 'CX-9', 'MX-5'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Convertible'] },
  'Mercedes-Benz': { models: ['A-Class', 'B-Class', 'C-Class', 'CLA', 'CLS', 'E-Class', 'G-Class', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'S-Class', 'V-Class', 'AMG GT'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Hatchback', 'Van'] },
  Mitsubishi: { models: ['ASX', 'Eclipse Cross', 'L200', 'Montero', 'Outlander', 'Pajero', 'Xpander'], bodyTypes: ['SUV', 'Pickup', 'MPV'] },
  Nissan: { models: ['Altima', 'Maxima', 'Micra', 'Pathfinder', 'Patrol', 'Sunny', 'X-Trail', 'Z'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Coupe'] },
  Porsche: { models: ['718 Boxster', '718 Cayman', '911', 'Cayenne', 'Macan', 'Panamera', 'Taycan'], bodyTypes: ['Sedan', 'SUV', 'Coupe', 'Convertible'] },
  Subaru: { models: ['BRZ', 'Forester', 'Impreza', 'Legacy', 'Outback', 'WRX', 'XV'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Wagon', 'Coupe'] },
  Tesla: { models: ['Model 3', 'Model S', 'Model X', 'Model Y', 'Cybertruck'], bodyTypes: ['Sedan', 'SUV', 'Pickup'] },
  Toyota: { models: ['4Runner', 'Avalon', 'Camry', 'Corolla', 'Fortuner', 'Hilux', 'Highlander', 'Land Cruiser', 'Prado', 'Prius', 'RAV4', 'Supra', 'Yaris'], bodyTypes: ['Sedan', 'SUV', 'Pickup', 'Hatchback', 'Coupe'] },
  Volkswagen: { models: ['Arteon', 'Atlas', 'Golf', 'ID.4', 'Jetta', 'Passat', 'Polo', 'Tiguan', 'Touareg'], bodyTypes: ['Sedan', 'SUV', 'Hatchback', 'Wagon'] }
};

export const CAR_BODY_TYPES = ['Sedan', 'SUV', 'Coupe', 'Hatchback', 'Wagon', 'Pickup', 'Convertible', 'Van', 'MPV', 'E30', 'E34', 'E36', 'E38', 'E39', 'E46', 'E53', 'E60', 'E65', 'E70', 'E71', 'E82', 'E83', 'E87', 'E90', 'E91', 'E92', 'E93', 'F10', 'F15', 'F20', 'F22', 'F25', 'F30', 'F32', 'G20', 'G30'];

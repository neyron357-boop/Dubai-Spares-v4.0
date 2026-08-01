import { Source } from '../types';

type ContactChannel = 'whatsapp' | 'telegram' | 'instagram' | 'email' | 'phone';

export type PublicOrderValidationError = {
  field: string;
  message: string;
};

interface RequestedPartValidationInput {
  name: string;
  comment: string;
}

interface Step1Input {
  brand: string;
  model: string;
  year: string;
  bodyType: string;
  vin: string;
}

interface Step2Input {
  requestedParts: RequestedPartValidationInput[];
}

interface Step3Input {
  deliveryCountry: string;
  preferredContactChannel: ContactChannel;
  customerContact: string;
  contactCountryCode: string;
  telegramContact: string;
  instagramContact: string;
  emailContact: string;
  phoneContact: string;
  bestContactTime: string;
}

export const CONTACT_CHANNEL_TO_SOURCE: Record<ContactChannel, Source> = {
  whatsapp: Source.WHATSAPP,
  telegram: Source.TELEGRAM,
  instagram: Source.INSTAGRAM,
  email: Source.OTHER,
  phone: Source.OTHER
};

const isValidVin = (value: string) => !value || /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
export const validateStep1 = (data: Step1Input): PublicOrderValidationError[] => {
  const errors: PublicOrderValidationError[] = [];
  if (!data.brand) errors.push({ field: 'brand', message: 'Выберите марку' });
  if (!data.model.trim()) errors.push({ field: 'model', message: 'Выберите или введите модель' });
  if (!data.year) errors.push({ field: 'year', message: 'Выберите год' });
  if (Number(data.year) > new Date().getFullYear()) errors.push({ field: 'year', message: 'Год не может быть больше текущего' });
  if (data.bodyType.length > 40) errors.push({ field: 'bodyType', message: 'Максимум 40 символов' });

  if (data.vin.trim() && data.vin.trim().length !== 17) {
    errors.push({ field: 'vin', message: 'VIN должен быть 17 символов' });
  } else if (!isValidVin(data.vin.trim())) {
    errors.push({ field: 'vin', message: 'VIN содержит недопустимые символы (I/O/Q запрещены)' });
  }

  return errors;
};

export const validateStep2 = (data: Step2Input): PublicOrderValidationError[] => {
  const errors: PublicOrderValidationError[] = [];
  const meaningfulParts = data.requestedParts.filter((part) => part.name.trim() || part.comment.trim());

  if (!meaningfulParts.length) {
    errors.push({ field: 'partName-0', message: 'Укажите деталь (например: амортизатор, фара…)' });
    return errors;
  }

  meaningfulParts.forEach((part, index) => {
    const cleanName = part.name.trim();
    if (!cleanName) {
      errors.push({ field: `partName-${index}`, message: 'Укажите деталь (например: амортизатор, фара…)' });
    } else if (cleanName.length < 2) {
      errors.push({ field: `partName-${index}`, message: 'Минимум 2 символа' });
    }

  });

  return errors;
};

export const validateStep3 = (data: Step3Input): PublicOrderValidationError[] => {
  const errors: PublicOrderValidationError[] = [];
  if (!data.deliveryCountry) errors.push({ field: 'deliveryCountry', message: 'Выберите страну доставки' });

  if (data.bestContactTime.trim() && !/^([01]\d|2[0-3]):[0-5]\d\s-\s([01]\d|2[0-3]):[0-5]\d$/.test(data.bestContactTime.trim())) {
    errors.push({ field: 'bestContactTime', message: 'Выберите интервал из списка' });
  }

  return errors;
};

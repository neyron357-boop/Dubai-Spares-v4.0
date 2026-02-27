import { Source } from '../types';

type ContactChannel = 'whatsapp' | 'telegram' | 'email' | 'phone';

export type PublicOrderValidationError = {
  field: string;
  message: string;
};

interface RequestedPartValidationInput {
  name: string;
  quantity: string;
  side: string;
  partCode: string;
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
  emailContact: string;
  phoneContact: string;
  bestContactTime: string;
}

export const CONTACT_CHANNEL_TO_SOURCE: Record<ContactChannel, Source> = {
  whatsapp: Source.WHATSAPP,
  telegram: Source.TELEGRAM,
  email: Source.OTHER,
  phone: Source.OTHER
};

const isValidVin = (value: string) => !value || /^[A-HJ-NPR-Z0-9]{17}$/.test(value);
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const isValidTelegram = (value: string) => /^@?[A-Za-z0-9_]{5,}$/.test(value.trim());

const isValidWhatsapp = (customerContact: string, contactCountryCode: string) => {
  const digits = customerContact.replace(/\D/g, '');
  if (contactCountryCode === '+971') return digits.length === 9;
  return digits.length >= 8 && digits.length <= 15;
};

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
  const meaningfulParts = data.requestedParts.filter((part) => part.name.trim() || part.partCode.trim() || part.comment.trim());

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

    if (!part.side) {
      errors.push({ field: `side-${index}`, message: 'Выберите сторону' });
    }

    if (part.partCode && !/^\d{1,12}$/.test(part.partCode)) {
      errors.push({ field: `partCode-${index}`, message: 'Код детали: только цифры (до 12)' });
    }

    const qty = Number(part.quantity || '0');
    if (part.quantity && (!Number.isInteger(qty) || qty < 1 || qty > 10)) {
      errors.push({ field: `quantity-${index}`, message: 'Количество: от 1 до 10' });
    }
  });

  return errors;
};

export const validateStep3 = (data: Step3Input): PublicOrderValidationError[] => {
  const errors: PublicOrderValidationError[] = [];
  if (!data.deliveryCountry) errors.push({ field: 'deliveryCountry', message: 'Выберите страну доставки' });

  if (data.preferredContactChannel === 'whatsapp') {
    if (!data.customerContact.trim()) {
      errors.push({ field: 'phone', message: 'Укажите WhatsApp номер' });
    } else if (!isValidWhatsapp(data.customerContact, data.contactCountryCode)) {
      errors.push({ field: 'phone', message: 'Введите номер полностью' });
    }
  }

  if (data.preferredContactChannel === 'telegram') {
    if (!data.telegramContact.trim()) {
      errors.push({ field: 'telegram', message: 'Укажите Telegram' });
    } else if (!isValidTelegram(data.telegramContact)) {
      errors.push({ field: 'telegram', message: 'Введите корректный Telegram (@username)' });
    }
  }

  if (data.preferredContactChannel === 'email') {
    if (!data.emailContact.trim()) {
      errors.push({ field: 'email', message: 'Укажите e-mail' });
    } else if (!isValidEmail(data.emailContact)) {
      errors.push({ field: 'email', message: 'Введите корректный e-mail' });
    }
  }

  if (data.preferredContactChannel === 'phone') {
    if (!data.phoneContact.trim()) {
      errors.push({ field: 'phoneAlt', message: 'Укажите номер телефона' });
    } else if (data.phoneContact.replace(/\D/g, '').length < 9) {
      errors.push({ field: 'phoneAlt', message: 'Введите корректный номер телефона (минимум 9 цифр)' });
    }
  }

  if (data.bestContactTime.trim() && !/^([01]\d|2[0-3]):[0-5]\d\s-\s([01]\d|2[0-3]):[0-5]\d\s[A-Za-z]{2,5}$/.test(data.bestContactTime.trim())) {
    errors.push({ field: 'bestContactTime', message: 'Формат: HH:MM - HH:MM TZ (например 10:00 - 14:00 GST)' });
  }

  return errors;
};

const envValue = (import.meta.env.VITE_LOCAL_ONLY ?? '1').toString().trim().toLowerCase();

export const LOCAL_ONLY = envValue !== '0' && envValue !== 'false' && envValue !== 'off';
export const LOCAL_MODE_LABEL = 'LOCAL MODE';

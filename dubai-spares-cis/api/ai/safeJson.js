const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

export const safeJsonParse = (value) => {
  if (isObject(value) || Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const extractJsonFromText = (value) => {
  if (typeof value !== 'string') return null;

  const fencedMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    const parsed = safeJsonParse(fencedMatch[1].trim());
    if (parsed !== null) return parsed;
  }

  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return safeJsonParse(value.slice(start, end + 1));
  }

  const arrayStart = value.indexOf('[');
  const arrayEnd = value.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    return safeJsonParse(value.slice(arrayStart, arrayEnd + 1));
  }

  return null;
};

/** Preserve decimal editing and pasted currency amounts without multiplying the price by 100. */
export function sanitizeMoneyInput(value: string) {
  let clean = value.replace(/[^\d.,]/g, '');
  if (clean.includes(',') && clean.includes('.')) {
    const last = Math.max(clean.lastIndexOf(','), clean.lastIndexOf('.'));
    clean = clean.slice(0, last).replace(/[.,]/g, '') + '.' + clean.slice(last + 1);
  } else clean = clean.replace(',', '.');
  const [whole, ...fraction] = clean.split('.');
  return fraction.length ? `${whole || '0'}.${fraction.join('').slice(0, 2)}` : whole;
}

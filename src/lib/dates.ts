/** Recognize only ISO dates and the atelier's previous "AUG 24, 2026" format. */
export function normalizeDueDate(value: string): string | null {
  let parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  let year: number; let month: number; let day: number;
  if (parts) { year = Number(parts[1]); month = Number(parts[2]); day = Number(parts[3]); }
  else {
    parts = /^([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(value.trim().toUpperCase());
    if (!parts) return null;
    month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(parts[1]) + 1;
    day = Number(parts[2]); year = Number(parts[3]);
  }
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

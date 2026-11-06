/** Validate entered dollars before conversion to binary floating point. */
export function validWeeklyRent(value) {
  const text = String(value).trim();
  return /^\d+(?:\.\d{1,2})?$/.test(text) && Number(text) > 0 && Number(text) <= 10000;
}

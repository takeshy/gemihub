/** Convert a complete calendar value to ISO without applying a time zone. */
export function parseDateInput(value: string, withTime = false): string | undefined {
  const match = value.trim().match(withTime
    ? /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})$/
    : /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const date = new Date(0);
  date.setUTCFullYear(+year, +month - 1, +day);
  if (+year < 1 || date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day || +hour > 23 || +minute > 59) return undefined;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return withTime ? `${iso}T${hour.padStart(2, "0")}:${minute}` : iso;
}

export function displayDateInput(value: string): string {
  return value.replace(/-/g, "/").replace("T", " ");
}

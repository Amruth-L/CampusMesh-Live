// DBIT rentals use inclusive calendar dates in Asia/Kolkata, not elapsed hours.
export function campusToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function rentalDays(start, end) {
  return validDate(start) && validDate(end) && end >= start
    ? (Date.parse(end) - Date.parse(start)) / 86400000 + 1
    : 0;
}
export function dateError(start, end, today = campusToday()) {
  if (!rentalDays(start, end))
    return "Choose valid dates; the end date can be the same as the start date.";
  if (start < today) return "Start date cannot be in the past.";
  return "";
}
export function overlaps(start, end, ranges = []) {
  return ranges.some(
    (r) =>
      start <= (r.end_date || r.end).slice(0, 10) &&
      end >= (r.start_date || r.start).slice(0, 10),
  );
}

// datetime-local uses wall-clock time, unlike the UTC string from toISOString().
export function toLocalDateTime(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

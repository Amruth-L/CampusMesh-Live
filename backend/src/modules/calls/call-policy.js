// Pure calling rules: eligibility stages, consent categories and India-time windows.
// No database access or provider requests belong in this module.
const E164 = /^\+[1-9]\d{7,14}$/;
const activeRentalStatuses = [
  'RENTAL_ACTIVE',
  'RETURN_PENDING',
  'RETURN_MATCHING',
  'RETURN_COURIER_ASSIGNED',
];
function localTime(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}
function inCallWindow(date = new Date()) {
  const { hour } = localTime(date);
  return hour >= 9 && hour < 19;
}
function reminderStage(endDate, today = localTime().day) {
  const delta = Math.round(
    (Date.parse(endDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000,
  );
  return delta === 4
    ? 'in 4 days'
    : delta === 1
      ? 'tomorrow'
      : delta === 0
        ? 'today'
        : delta === -1
          ? 'overdue'
          : null;
}
const consentFor = (kind) =>
  ({
    WELCOME: 'welcome_enabled',
    SIGN_IN_GREETING: 'login_calls_enabled',
    BOOKING_CONFIRMATION: 'booking_enabled',
    DUE_REMINDER: 'reminders_enabled',
    RECOMMENDATION: 'recommendations_enabled',
  })[kind];
const bookingStatuses = [
  'QR_GENERATED',
  'MATCHING_COURIER',
  'NO_COURIER_AVAILABLE',
  'COURIER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'RENTAL_ACTIVE',
];

module.exports = {
  E164,
  activeRentalStatuses,
  bookingStatuses,
  localTime,
  inCallWindow,
  reminderStage,
  consentFor,
};

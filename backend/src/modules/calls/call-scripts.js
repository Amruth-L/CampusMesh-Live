// Spoken messages are separate from scheduling and payment eligibility.
const { providerName } = require('./call.config');
function spokenDate(value) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value + 'T00:00:00Z'));
}
function scriptFor(kind, data) {
  if (kind === 'WELCOME')
    return "Hi! This is CampusMesh's automated assistant. Welcome to CampusMesh! We’re happy to have you here. You can rent useful items, lend what you own, or earn by delivering on your campus. Open the app to get started. Thanks for joining our campus community!";
  if (kind === 'SIGN_IN_GREETING')
    return "Hello! This is CampusMesh's automated assistant. Welcome back to CampusMesh! We’re happy to see you again. Open the app to browse items, manage your rentals, or help with a delivery. Thank you for using CampusMesh.";
  if (kind === 'BOOKING_CONFIRMATION')
    return `Hi! This is CampusMesh's automated assistant. Thank you for booking ${data.title}. We’re happy to help you get what you need! Your payment is confirmed. ${data.delivery_requested ? 'Open My rentals to see your delivery assignment and tracking.' : 'Open My rentals for your pickup details and handover code.'} Your agreed return date is ${spokenDate(data.end_date)}. Enjoy your rental!`;
  if (kind === 'DUE_REMINDER')
    return `This is CampusMesh's automated assistant. Your rental of ${data.title} is ${data.stage === 'overdue' ? 'past its return date' : `due ${data.stage}`}. The agreed return date is ${spokenDate(data.end_date)}. Please open My rentals to arrange the return or request an extension. An extension needs approval. We will never ask for an account OTP or payment PIN on this call.`;
  return `This is CampusMesh's automated assistant. You opted in to rental recommendations. ${data.title} is listed at ${Number(data.rent_price)} rupees per day. ${data.reason}. You can review dates and availability in CampusMesh. No booking or payment will be made on this call.`;
}
function providerScript(kind, data, c) {
  if (providerName(c) !== 'authkey') return scriptFor(kind, data);
  // Authkey's simple TTS API has no authenticated IVR flow. Keep item names
  // and account details in the app, and never advertise unsupported keypad actions.
  const ending = ' You can turn off calls in Reminders in CampusMesh. Goodbye.';
  if (kind === 'WELCOME' || kind === 'SIGN_IN_GREETING') return scriptFor(kind, data) + ending;
  if (kind === 'BOOKING_CONFIRMATION')
    return (
      `Hello! This is CampusMesh's automated assistant. Thank you for placing your rental order. Your booking is confirmed. Open My rentals for ${data.delivery_requested ? 'delivery tracking' : 'pickup details'}. Your agreed return date is ${spokenDate(data.end_date)}.` +
      ending
    );
  if (kind === 'DUE_REMINDER')
    return (
      `Hello! This is CampusMesh's automated assistant. Your rental ${data.stage === 'overdue' ? 'is past its return date' : `is due ${data.stage}`}. The agreed return date is ${spokenDate(data.end_date)}. Please open My rentals to arrange the return or request an extension.` +
      ending
    );
  return '';
}

module.exports = { scriptFor, providerScript };

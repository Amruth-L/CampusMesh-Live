// Explain the same gates used by the worker without creating a job or placing a call.
const reason = (code, message) => ({ code, message });

function accountReadiness(status, preferences) {
  const reasons = [];
  if (status.activationPending)
    reasons.push(reason('PROVIDER_ACTIVATION_PENDING', 'Automatic calls are waiting for service activation. Your preferences are saved.'));
  else if (!status.configured)
    reasons.push(
      reason('PROVIDER_UNAVAILABLE', 'Phone calls are in preview mode. No real call will be placed.'),
    );
  else if (!status.schedulerEnabled) reasons.push(reason('SCHEDULER_PAUSED', 'Automatic calling is paused.'));
  if (!preferences.phone_e164)
    reasons.push(reason('PHONE_MISSING', 'Save a mobile number with its country code.'));
  else if (!preferences.phone_verified_at)
    reasons.push(
      reason(
        'PHONE_UNVERIFIED',
        status.trialMode
          ? 'Your mobile number is saved, but it is not approved for calls yet. Ask the project owner to verify it in Twilio and link it to your CampusMesh account.'
          : status.phoneVerificationConfigured
            ? status.phoneVerificationChannel === 'voice'
              ? 'Verify your mobile once with a code delivered by an automated call. Future eligible calls run automatically.'
              : 'Verify your saved mobile number to receive calls.'
            : 'Phone verification will be available here after calling setup is complete.',
      ),
    );
  if (status.provider === 'authkey' && preferences.phone_e164 && !/^\+91[6-9]\d{9}$/.test(preferences.phone_e164))
    reasons.push(reason('PHONE_UNSUPPORTED', 'This calling service supports Indian mobile numbers. Save +91 followed by your 10-digit mobile number.'));
  if (
    !['welcome_enabled', 'login_calls_enabled', 'booking_enabled', 'reminders_enabled', ...(status.recommendationsAvailable === false ? [] : ['recommendations_enabled'])].some(
      (key) => preferences[key],
    )
  )
    reasons.push(reason('CALLS_OPTED_OUT', 'Choose the types of call you want and save your preferences.'));
  const blocked = reasons.length > 0;
  if (!status.withinCallWindow)
    reasons.push(
      reason(
        'QUIET_HOURS',
        'Calls are placed from 9 am to 7 pm India time. Eligible updates wait until the next calling window.',
      ),
    );
  return {
    state: blocked ? 'blocked' : status.withinCallWindow ? 'ready' : 'scheduled',
    title: status.activationPending
      ? 'Automatic calling is awaiting activation'
      : !status.configured
        ? 'Automatic calling is not connected'
        : !status.schedulerEnabled
          ? 'Automatic calling is paused'
          : blocked
            ? reasons.some((item) => item.code.startsWith('PHONE_'))
              ? 'Your number is not ready for automatic calls'
              : 'Choose which automatic calls you want'
            : status.withinCallWindow
              ? 'Your number is ready for eligible updates'
              : 'Your next eligible call waits until 9 am',
    reasons,
  };
}

function bookingReadiness({ rental, preferences, status, latestCall, bookingStatuses, now }) {
  const reasons = [];
  if (rental.demo_slug)
    reasons.push(
      reason(
        'DEMO_RENTAL',
        'This is a sample listing. Demo bookings do not trigger booking or return-reminder calls.',
      ),
    );
  if (rental.payment_status !== 'FULLY_PAID')
    reasons.push(
      reason(
        'BOOKING_NOT_CONFIRMED',
        'The booking call starts after owner approval and the refundable deposit are complete. Paying the initial rental fee submits your request.',
      ),
    );
  else if (!bookingStatuses.includes(rental.status))
    reasons.push(
      reason(
        'RENTAL_NOT_ELIGIBLE',
        'This rental is no longer at a stage that receives a booking-confirmation call.',
      ),
    );
  else if (
    !rental.booking_confirmed_at ||
    new Date(rental.booking_confirmed_at).getTime() < now.getTime() - 86400000
  )
    reasons.push(
      reason(
        'BOOKING_WINDOW_PASSED',
        'Booking-confirmation calls are available during the first 24 hours after the booking is fully confirmed.',
      ),
    );
  if (!preferences.booking_enabled)
    reasons.push(
      reason('BOOKING_OPTED_OUT', 'Enable booking confirmations in Reminder calls to receive this update.'),
    );
  reasons.push(
    ...accountReadiness(status, preferences).reasons.filter((item) => item.code !== 'CALLS_OPTED_OUT'),
  );
  const blocked = reasons.some((item) => item.code !== 'QUIET_HOURS');
  const attempted =
    latestCall?.started_at ||
    ['SENT', 'RINGING', 'ANSWERED', 'COMPLETED', 'FAILED', 'UNKNOWN'].includes(latestCall?.status);
  return {
    rentalId: rental.id,
    state: attempted
      ? 'attempted'
      : blocked
        ? 'blocked'
        : latestCall?.status === 'QUEUED'
          ? 'queued'
          : 'scheduled',
    title: attempted
      ? 'Booking call history'
      : blocked
        ? 'Booking call not scheduled'
        : latestCall?.status === 'QUEUED'
          ? 'Booking call queued'
          : 'Booking call will be checked automatically',
    reasons,
    callWindow: status.window,
    phoneVerified: Boolean(preferences.phone_verified_at),
    latestCall: latestCall || null,
  };
}

module.exports = { accountReadiness, bookingReadiness };

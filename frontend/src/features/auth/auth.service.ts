// =====================================================
// CampusMesh — Auth Service
// Thin wrapper around the existing Axios API instance.
// All API calls map to the existing backend routes.
// =====================================================

import type {
  LoginPayload,
  LoginResponse,
  SignupPayload,
  MessageResponse,
  ForgotPasswordPayload,
  ResetPasswordPayload,
  VerifyEmailPayload,
  ResendOtpPayload,
} from './auth.types';

/**
 * Calls POST /login with email, password and an optional retry-stable attempt ID.
 * Returns the JWT token on success.
 */
export async function loginUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  payload: LoginPayload
): Promise<LoginResponse> {
  const res = await api.post('/login', {
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    login_attempt_id: payload.login_attempt_id,
  });
  return res.data as LoginResponse;
}

/**
 * Calls POST /signup with name, username, email, password.
 * On success navigates the caller to /verify-email.
 */
export async function signupUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  payload: SignupPayload
): Promise<MessageResponse> {
  const res = await api.post('/signup', {
    name: payload.name,
    username: payload.username.trim().toLowerCase(),
    email: payload.email.trim().toLowerCase(),
    password: payload.password,
    phone_number: payload.phone_number,
    welcome_enabled: payload.welcome_enabled,
    login_calls_enabled: payload.login_calls_enabled,
    rental_calls_enabled: payload.rental_calls_enabled,
  });
  return res.data as MessageResponse;
}

/**
 * Calls POST /forgot-password with email.
 * Backend sends OTP to that email address.
 */
export async function requestPasswordReset(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  payload: ForgotPasswordPayload
): Promise<MessageResponse> {
  const res = await api.post('/forgot-password', { email: payload.email });
  return res.data as MessageResponse;
}

/**
 * Calls POST /reset-password with email, otp, newPassword.
 */
export async function resetPassword(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  payload: ResetPasswordPayload
): Promise<MessageResponse> {
  const res = await api.post('/reset-password', {
    email: payload.email,
    otp: payload.otp,
    newPassword: payload.newPassword,
  });
  return res.data as MessageResponse;
}

/**
 * Calls POST /verify-email with email + otp.
 */
export async function verifyEmail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  payload: VerifyEmailPayload
): Promise<MessageResponse> {
  const res = await api.post('/verify-email', {
    email: payload.email,
    otp: payload.otp,
  });
  return res.data as MessageResponse;
}

/**
 * Calls POST /resend-otp with email.
 */
export async function resendOtp(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any,
  payload: ResendOtpPayload
): Promise<MessageResponse> {
  const res = await api.post('/resend-otp', { email: payload.email });
  return res.data as MessageResponse;
}

/**
 * Extracts a human-readable error message from an Axios error response.
 */
export function getApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err && typeof err === 'object' && 'response' in err) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = (err as any).response;
    return resp?.data?.message || resp?.data?.error || fallback;
  }
  if (err && typeof err === 'object' && 'request' in err) {
    return 'We couldn’t connect. Check your connection and try again.';
  }
  return fallback;
}

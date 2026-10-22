// =====================================================
// CampusMesh — Auth Types
// =====================================================

/** The shape of the user object returned by /me */
export interface AuthUser {
  id: number | string;
  name: string;
  username: string;
  email: string;
  is_verified?: boolean;
  profile_picture?: string | null;
  bio?: string | null;
  rating?: number | null;
  mesh_score?: number | null;
}

/** Context value exposed by AuthContext */
export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<AuthUser>) => Promise<AuthUser>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any; // axios instance — typed loosely to avoid importing axios types here
}

// ── Request Payloads ──────────────────────────────

export interface LoginPayload {
  email: string;
  password: string;
  login_attempt_id?: string;
}

export interface SignupPayload {
  name: string;
  username: string;
  email: string;
  password: string;
  phone_number: string;
  welcome_enabled: boolean;
  login_calls_enabled?: boolean;
  rental_calls_enabled?: boolean;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  email: string;
  otp: string;
  newPassword: string;
}

export interface VerifyEmailPayload {
  email: string;
  otp: string;
}

export interface ResendOtpPayload {
  email: string;
}

// ── Response Shapes ──────────────────────────────

export interface LoginResponse {
  token: string;
  welcomeCallSetupNeeded?: boolean;
  message?: string;
}

export interface MessageResponse {
  message: string;
  retryAfter?: number;
  expiresIn?: number;
}

// ── Form State ──────────────────────────────

export interface LoginFormData {
  email: string;
  password: string;
  remember: boolean;
}

export interface SignupFormData {
  name: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone_number: string;
}

export interface SignupFieldErrors {
  name?: string;
  username?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  phone_number?: string;
}

export type AuthLoadingState = 'idle' | 'loading' | 'success' | 'error';


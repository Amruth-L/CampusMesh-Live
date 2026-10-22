import { useCallback, useEffect, useState } from 'react';
export default function useOtpCooldown(email, purpose) {
  const key = `cm:otp:${purpose}:${email.trim().toLowerCase()}`;
  const [now, setNow] = useState(Date.now());
  const [deadline, setDeadline] = useState(() => Number(sessionStorage.getItem(key)) || 0);
  useEffect(() => { setNow(Date.now()); setDeadline(Number(sessionStorage.getItem(key)) || 0); }, [key]);
  useEffect(() => {
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const start = useCallback((seconds = 60) => {
    const end = Date.now() + seconds * 1000;
    sessionStorage.setItem(key, String(end));
    setNow(Date.now());
    setDeadline(end);
  }, [key]);
  return { remaining: Math.max(0, Math.ceil((deadline - now) / 1000)), start };
}

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../lib/api';

import { AuthContext } from './auth-context';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [voicePrompt, setVoicePrompt] = useState(false);
  const navigate = useNavigate();

  // Axios instance with default base URL
  const api = useMemo(() => {
    const instance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 20000
    });
    instance.interceptors.request.use((config) => {
      const activeToken = localStorage.getItem('token');
      if (activeToken) config.headers.Authorization = `Bearer ${activeToken}`;
      return config;
    });
    return instance;
  }, []);

  const retrySession = useCallback(async () => {
    const activeToken = localStorage.getItem('token');
    setLoading(true);
    setSessionError('');
    try {
      if (activeToken) {
        const res = await api.get('/me');
        if (localStorage.getItem('token') !== activeToken) return;
        setUser(res.data.profile);
        setToken(activeToken);
        setIsAuthenticated(true);
      } else {
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      if (localStorage.getItem('token') !== activeToken) return;
      if ([401, 403, 404].includes(error.response?.status)) {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
      } else {
        setSessionError('We couldn’t load your account. Your session is saved—please retry.');
      }
    } finally { setLoading(false); }
  }, [api]);
  useEffect(() => { retrySession(); }, [retrySession]);
  useEffect(() => {
    const changed = event => { if (event.key === 'token') retrySession(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [retrySession]);

  const login = async (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    try {
      const res = await api.get('/me', {
        headers: { Authorization: `Bearer ${newToken}` }
      });
      setUser(res.data.profile);
      setIsAuthenticated(true);
      setVoicePrompt(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    } catch (err) {
      console.error("Login verification failed:", err);
      localStorage.removeItem('token');
      setToken(null);
      setUser(null);
      setIsAuthenticated(false);
      throw err;
    }
  };

  const clearSession = (destination = '/') => {
    setVoicePrompt(false);
    setSessionError('');
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    navigate(destination);
  };

  const logout = async () => {
    try {
      await api.post('/logout');
    } catch (error) {
      if (![401,403].includes(error.response?.status)) {
        setSessionError('Could not sign out securely. Check your connection and try again.');
        return false;
      }
    }
    clearSession();
    return true;
  };

  const updateProfile = async (profileData) => {
    try {
      const res = await api.put('/api/profile', profileData);
      const updatedUser = res.data.profile;
      if (profileData.new_password) {
        clearSession('/login');
        return updatedUser;
      }
      setUser(updatedUser);
      return updatedUser;
    } catch (err) {
      console.error("Failed to update profile", err);
      throw err;
    }
  };

  const setMode = async (mode) => {
    const res = await api.put('/mode', { mode });
    setUser(prev => ({ ...prev, ...res.data }));
    return res.data;
  };

  const setDeliveryAvailability = async (available) => {
    const res = await api.put('/delivery-availability', { available });
    setUser(prev => ({ ...prev, ...res.data }));
    return res.data;
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, sessionError, retrySession, isAuthenticated, login, logout, updateProfile, setMode, setDeliveryAvailability, api, voicePrompt, dismissVoicePrompt: () => setVoicePrompt(false) }}>
      {children}
    </AuthContext.Provider>
  );
};

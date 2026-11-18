import { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { authApi } from '../api/client';

// oxlint-disable-next-line react/only-export-components
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Active operation tracking to avoid race conditions with session restoration
  const isMountedRef = useRef(true);
  const sessionCheckIdRef = useRef(0);

  // Restore session on application mount using GET /api/auth/me
  useEffect(() => {
    isMountedRef.current = true;
    const currentCheckId = ++sessionCheckIdRef.current;

    async function restoreSession() {
      const storedToken = localStorage.getItem('token');
      if (!storedToken) {
        if (isMountedRef.current && sessionCheckIdRef.current === currentCheckId) {
          setUser(null);
          setToken(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const response = await authApi.getMe();
        if (isMountedRef.current && sessionCheckIdRef.current === currentCheckId) {
          // Backend returns { success: true, message: "...", data: { user: { id, name, email } } }
          setUser(response.data.data.user);
          setToken(storedToken);
        }
      } catch {
        if (isMountedRef.current && sessionCheckIdRef.current === currentCheckId) {
          localStorage.removeItem('token');
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isMountedRef.current && sessionCheckIdRef.current === currentCheckId) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Listen for the auth:unauthorized event dispatched by Axios interceptor
  useEffect(() => {
    function handleUnauthorized(event) {
      const failedToken = event.detail?.failedToken;
      const currentToken = localStorage.getItem('token');

      // Do not clear state if user already logged in with a newer token
      if (!failedToken || failedToken === currentToken) {
        localStorage.removeItem('token');
        setToken(null);
        setUser(null);
      }
    }

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  // Authenticate user with credentials
  const login = useCallback(async (email, password) => {
    // Invalidate any in-flight background session check
    sessionCheckIdRef.current++;

    const response = await authApi.login({ email, password });
    const { user: userData, token: jwtToken } = response.data.data;

    localStorage.setItem('token', jwtToken);
    setToken(jwtToken);
    setUser(userData);
    setIsLoading(false);

    return userData;
  }, []);

  // Register a new user
  const register = useCallback(async (name, email, password) => {
    // Invalidate any in-flight background session check
    sessionCheckIdRef.current++;

    const response = await authApi.register({ name, email, password });
    const { user: userData, token: jwtToken } = response.data.data;

    localStorage.setItem('token', jwtToken);
    setToken(jwtToken);
    setUser(userData);
    setIsLoading(false);

    return userData;
  }, []);

  // Logout user and clear stored authentication state
  const logout = useCallback(() => {
    sessionCheckIdRef.current++;
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setIsLoading(false);
  }, []);

  const value = {
    user,
    token,
    isLoading,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

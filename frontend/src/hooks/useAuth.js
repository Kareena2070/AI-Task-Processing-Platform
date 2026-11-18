import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Custom hook to access authentication context.
 *
 * @returns {{
 *   user: { id: string, name: string, email: string } | null,
 *   token: string | null,
 *   isLoading: boolean,
 *   login: (email: string, password: string) => Promise<object>,
 *   register: (name: string, email: string, password: string) => Promise<object>,
 *   logout: () => void
 * }}
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default useAuth;

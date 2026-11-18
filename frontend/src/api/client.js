import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: inject JWT Bearer token from localStorage
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
      // Track token attached to this specific request for race-condition safe 401 handling
      config._token = token;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// State tracking for duplicate unauthorized event suppression
let lastUnauthorizedToken = null;
let lastUnauthorizedTime = 0;

// Response interceptor: handle 401 responses carefully without race conditions
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = error.config?.url || '';
      const isAuthEndpoint =
        requestUrl.includes('/auth/login') || requestUrl.includes('/auth/register');

      // Exclude login and registration requests (invalid credentials should be handled by the caller)
      if (!isAuthEndpoint) {
        const tokenUsed = error.config?._token;
        const currentToken = localStorage.getItem('token');

        // Do not trigger unauthorized logout if user has already logged in with a newer token
        if (!tokenUsed || tokenUsed === currentToken) {
          const now = Date.now();
          // Suppress duplicate rapid 401 events within 500ms for the same token
          if (tokenUsed !== lastUnauthorizedToken || now - lastUnauthorizedTime > 500) {
            lastUnauthorizedToken = tokenUsed;
            lastUnauthorizedTime = now;
            window.dispatchEvent(
              new CustomEvent('auth:unauthorized', {
                detail: { failedToken: tokenUsed },
              })
            );
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Normalizes error responses from API or network failures into a readable string message.
 * Never exposes sensitive tokens or credentials.
 *
 * @param {Error|import('axios').AxiosError} error
 * @returns {string}
 */
export function getErrorMessage(error) {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  return error.message || 'An unexpected error occurred';
}

/**
 * Authentication API helpers matching verified backend endpoint contracts.
 */
export const authApi = {
  register: (data, config) => apiClient.post('/auth/register', data, config),
  login: (data, config) => apiClient.post('/auth/login', data, config),
  getMe: (config) => apiClient.get('/auth/me', config),
};

export default apiClient;

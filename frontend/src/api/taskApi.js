import apiClient from './client.js';

/**
 * Task API service module using the centralized Axios client.
 */
export const taskApi = {
  /**
   * Fetches paginated tasks belonging to the authenticated user.
   *
   * @param {object} [params]
   * @param {number} [params.page=1]
   * @param {number} [params.limit=10]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<import('axios').AxiosResponse<{ success: boolean, message: string, data: { tasks: Array<object>, pagination: { page: number, limit: number, totalTasks: number, totalPages: number } } }>>}
   */
  getTasks: ({ page = 1, limit = 10, signal } = {}) =>
    apiClient.get('/tasks', {
      params: { page, limit },
      signal,
    }),

  /**
   * Fetches a single task by ID scoped to the authenticated user.
   *
   * @param {string} taskId
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<import('axios').AxiosResponse<{ success: boolean, message: string, data: { task: object } }>>}
   */
  getTaskById: (taskId, { signal } = {}) =>
    apiClient.get(`/tasks/${taskId}`, { signal }),

  /**
   * Fetches execution logs for a task.
   *
   * @param {string} taskId
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<import('axios').AxiosResponse<{ success: boolean, message: string, data: { taskId: string, status: string, logs: Array<object> } }>>}
   */
  getTaskLogs: (taskId, { signal } = {}) =>
    apiClient.get(`/tasks/${taskId}/logs`, { signal }),

  /**
   * Creates a new task.
   *
   * @param {object} taskData
   * @param {string} taskData.title
   * @param {string} taskData.operation
   * @param {string|object} taskData.input
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<import('axios').AxiosResponse<{ success: boolean, message: string, data: { task: object } }>>}
   */
  createTask: ({ title, operation, input }, { signal } = {}) =>
    apiClient.post('/tasks', { title, operation, input }, { signal }),

  /**
   * Updates permitted fields (title, operation, input) of a task.
   *
   * @param {string} taskId
   * @param {object} updateData
   * @param {string} [updateData.title]
   * @param {string} [updateData.operation]
   * @param {string|object} [updateData.input]
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<import('axios').AxiosResponse<{ success: boolean, message: string, data: { task: object } }>>}
   */
  updateTask: (taskId, { title, operation, input }, { signal } = {}) =>
    apiClient.patch(`/tasks/${taskId}`, { title, operation, input }, { signal }),

  /**
   * Deletes a task owned by the authenticated user.
   *
   * @param {string} taskId
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<import('axios').AxiosResponse<{ success: boolean, message: string, data: { task: { id: string } } }>>}
   */
  deleteTask: (taskId, { signal } = {}) =>
    apiClient.delete(`/tasks/${taskId}`, { signal }),
};

export default taskApi;

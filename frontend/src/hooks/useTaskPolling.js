import { useState, useEffect, useRef, useCallback } from 'react';
import taskApi from '../api/taskApi.js';
import { getErrorMessage } from '../api/client.js';

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];
const POLL_INTERVAL_MS = 2000;

/**
 * Custom hook to fetch task details and execution logs with live 2-second polling
 * for pending/processing tasks, abort controller cancellation, and race-condition guards.
 *
 * @param {string} taskId
 * @returns {{
 *   task: object|null,
 *   logs: Array<object>,
 *   status: string|null,
 *   isLoading: boolean,
 *   error: string|null,
 *   isPolling: boolean,
 *   refetch: () => void
 * }}
 */
export function useTaskPolling(taskId) {
  const [task, setTask] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Task-specific request generation guard to prevent older requests from updating newer taskId
  const generationRef = useRef(0);
  const timerRef = useRef(null);
  const abortControllerRef = useRef(null);

  const fetchTaskAndLogs = useCallback(async () => {
    if (!taskId) return;

    const currentGen = ++generationRef.current;

    // Clear any pending timer and abort in-flight request
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    async function poll() {
      if (currentGen !== generationRef.current) return;

      try {
        const [taskRes, logsRes] = await Promise.all([
          taskApi.getTaskById(taskId, { signal: abortController.signal }),
          taskApi.getTaskLogs(taskId, { signal: abortController.signal }),
        ]);

        // Discard stale responses from older generation
        if (currentGen !== generationRef.current) return;

        const fetchedTask = taskRes.data.data.task;
        const fetchedLogs = logsRes.data.data.logs || [];
        const currentStatus = fetchedTask.status || logsRes.data.data.status;

        setTask(fetchedTask);
        setLogs(fetchedLogs);
        setStatus(currentStatus);
        setError(null);
        setIsLoading(false);

        // Terminal exit: stop polling when completed, failed, or cancelled
        if (TERMINAL_STATUSES.includes(currentStatus)) {
          return;
        }

        // Schedule next poll in 2 seconds only after previous call finished
        if (currentGen === generationRef.current) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (currentGen !== generationRef.current) return;
        if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') return;

        const statusCode = err.response?.status;
        const errorMessage = getErrorMessage(err);

        // Permanent errors (400, 401, 404): stop polling immediately, do not retry endlessly
        if (statusCode === 400 || statusCode === 401 || statusCode === 404) {
          setError(errorMessage);
          setIsLoading(false);
          return;
        }

        // Transient network or server error: record warning and retry after delay
        setError(errorMessage);
        setIsLoading(false);

        if (currentGen === generationRef.current) {
          timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      }
    }

    await poll();
  }, [taskId]);

  useEffect(() => {
    const generation = generationRef;
    const timer = timerRef;
    const abortController = abortControllerRef;

    // oxlint-disable-next-line react/set-state-in-effect
    setTask(null);
    setLogs([]);
    setStatus(null);
    setError(null);
    setIsLoading(true);

    fetchTaskAndLogs();

    return () => {
      // Invalidate current generation on unmount or taskId change
      generation.current++;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (abortController.current) {
        abortController.current.abort();
      }
    };
  }, [taskId, fetchTaskAndLogs]);

  const isPolling = Boolean(
    status && !TERMINAL_STATUSES.includes(status) && !error
  );

  return {
    task,
    logs,
    status,
    isLoading,
    error,
    isPolling,
    refetch: fetchTaskAndLogs,
  };
}

export default useTaskPolling;

/**
 * TaskResult displays the computed output or failure message according to current lifecycle state.
 *
 * @param {object} props
 * @param {object} props.task
 */
export default function TaskResult({ task }) {
  if (!task) return null;

  const { status, result, error, input } = task;

  return (
    <section className="task-result-card" aria-label="Task Execution Results">
      <h2>Execution Result</h2>

      {status === 'pending' && (
        <div className="task-status-banner banner-pending">
          <p>
            <strong>Waiting in queue:</strong> This task is pending and has not yet been claimed by a background worker. Live polling is active.
          </p>
        </div>
      )}

      {status === 'processing' && (
        <div className="task-status-banner banner-processing">
          <p>
            <strong>Currently processing:</strong> A background worker has claimed this task and execution is underway. Live polling is active.
          </p>
        </div>
      )}

      {status === 'cancelled' && (
        <div className="task-status-banner banner-cancelled">
          <p>
            <strong>Task Cancelled:</strong> This task was cancelled before completion.
          </p>
        </div>
      )}

      {status === 'failed' && (
        <div className="task-error-box" role="alert">
          <h3 className="error-box-title">Execution Error</h3>
          <pre className="error-box-content">{error || 'An unspecified execution error occurred during processing.'}</pre>
        </div>
      )}

      {status === 'completed' && (
        <div className="task-output-box">
          <h3 className="output-box-title">Worker Output</h3>
          {result !== null && result !== undefined ? (
            <pre className="output-box-content">{String(result)}</pre>
          ) : (
            <p className="output-box-empty">Worker completed without output data.</p>
          )}
        </div>
      )}

      <div className="task-input-section">
        <h3>Task Input</h3>
        <pre className="task-input-content">
          {typeof input === 'object' && input !== null
            ? JSON.stringify(input, null, 2)
            : String(input || '')}
        </pre>
      </div>
    </section>
  );
}

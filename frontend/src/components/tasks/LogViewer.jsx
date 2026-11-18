function formatLogTimestamp(isoString) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
    }).format(date);
  } catch {
    return String(isoString);
  }
}

/**
 * LogViewer displays task execution logs in strict chronological order.
 *
 * @param {object} props
 * @param {Array<object>} props.logs
 */
export default function LogViewer({ logs = [] }) {
  // Sort logs chronologically by timestamp
  const sortedLogs = [...logs].sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    return timeA - timeB;
  });

  return (
    <section className="log-viewer-card" aria-label="Task Execution Logs">
      <div className="log-viewer-header">
        <h2>Execution Logs</h2>
        <span className="log-count">
          {logs.length} log {logs.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {sortedLogs.length === 0 ? (
        <div className="log-empty-state">
          <p>No execution logs recorded yet. Logs will appear here as the worker processes the task.</p>
        </div>
      ) : (
        <div className="log-stream-container">
          <ul className="log-stream-list" role="log">
            {sortedLogs.map((log, index) => {
              const level = (log.level || 'info').toLowerCase();

              return (
                <li key={`${log.timestamp}-${index}`} className={`log-entry log-entry-${level}`}>
                  <time className="log-time" dateTime={log.timestamp}>
                    {formatLogTimestamp(log.timestamp)}
                  </time>
                  <span className={`log-level-badge log-level-${level}`}>
                    {level.toUpperCase()}
                  </span>
                  <span className="log-message">
                    {log.message}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

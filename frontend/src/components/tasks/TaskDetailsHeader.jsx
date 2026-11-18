import { Link } from 'react-router-dom';
import StatusBadge from '../StatusBadge';

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(date);
  } catch {
    return String(isoString);
  }
}

/**
 * TaskDetailsHeader displays the header banner, status badge,
 * operation type, creation timestamp, and navigation link back to the dashboard.
 *
 * @param {object} props
 * @param {object} props.task
 * @param {boolean} props.isPolling
 */
export default function TaskDetailsHeader({ task, isPolling = false }) {
  if (!task) return null;

  return (
    <header className="task-details-header">
      <div className="task-nav-back">
        <Link to="/" className="btn-secondary btn-xs">
          &larr; Back to Dashboard
        </Link>
      </div>

      <div className="task-header-main">
        <div className="task-header-title-row">
          <h1>{task.title}</h1>
          <div className="task-header-badges">
            <StatusBadge status={task.status} />
            <span className="task-op-badge">{task.operation}</span>
            {isPolling && (
              <span className="polling-indicator" title="Live 2-second polling active">
                <span className="polling-dot" /> Live Polling
              </span>
            )}
          </div>
        </div>

        <div className="task-header-meta">
          <span>Task ID: <code>{task.id}</code></span>
          <span>&bull;</span>
          <span>Created: {formatDate(task.createdAt)}</span>
        </div>
      </div>
    </header>
  );
}

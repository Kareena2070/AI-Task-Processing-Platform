const STATUS_CONFIG = {
  pending: {
    label: 'Waiting',
    className: 'status-badge-waiting',
  },
  processing: {
    label: 'Processing',
    className: 'status-badge-processing',
  },
  completed: {
    label: 'Completed',
    className: 'status-badge-completed',
  },
  failed: {
    label: 'Failed',
    className: 'status-badge-failed',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'status-badge-cancelled',
  },
};

/**
 * StatusBadge renders a restrained badge indicator for task lifecycle states.
 *
 * @param {object} props
 * @param {string} props.status
 */
export default function StatusBadge({ status }) {
  const normalizedStatus = (status || '').toLowerCase();
  const config = STATUS_CONFIG[normalizedStatus] || {
    label: status || 'Unknown',
    className: 'status-badge-cancelled',
  };

  return (
    <span className={`status-badge ${config.className}`}>
      {config.label}
    </span>
  );
}

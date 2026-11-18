/**
 * Displays task counters: total count from server pagination metadata,
 * and status breakdown calculated strictly from the currently loaded page.
 *
 * @param {object} props
 * @param {number} props.totalTasks
 * @param {Array<object>} props.currentPageTasks
 */
export default function TaskStats({ totalTasks = 0, currentPageTasks = [] }) {
  const waitingCount = currentPageTasks.filter((t) => t.status === 'pending').length;
  const processingCount = currentPageTasks.filter((t) => t.status === 'processing').length;
  const completedCount = currentPageTasks.filter((t) => t.status === 'completed').length;
  const failedCount = currentPageTasks.filter((t) => t.status === 'failed').length;
  const cancelledCount = currentPageTasks.filter((t) => t.status === 'cancelled').length;

  return (
    <section className="stats-grid" aria-label="Task Statistics">
      <div className="stat-card">
        <span className="stat-label">Total Tasks</span>
        <span className="stat-value">{totalTasks}</span>
        <span className="stat-subtext">All time</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Waiting</span>
        <span className="stat-value">{waitingCount}</span>
        <span className="stat-subtext">Current page</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Processing</span>
        <span className="stat-value">{processingCount}</span>
        <span className="stat-subtext">Current page</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Completed</span>
        <span className="stat-value">{completedCount}</span>
        <span className="stat-subtext">Current page</span>
      </div>

      <div className="stat-card">
        <span className="stat-label">Failed</span>
        <span className="stat-value">{failedCount}</span>
        <span className="stat-subtext">Current page</span>
      </div>

      {cancelledCount > 0 && (
        <div className="stat-card">
          <span className="stat-label">Cancelled</span>
          <span className="stat-value">{cancelledCount}</span>
          <span className="stat-subtext">Current page</span>
        </div>
      )}
    </section>
  );
}

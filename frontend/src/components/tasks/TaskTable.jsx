import { Link } from 'react-router-dom';
import StatusBadge from '../StatusBadge';

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return String(isoString);
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return String(isoString);
  }
}

/**
 * TaskTable renders the list of tasks for the current page view.
 *
 * @param {object} props
 * @param {Array<object>} props.tasks
 * @param {string} props.activeFilter
 * @param {(task: object) => void} props.onEdit
 * @param {(task: object) => void} props.onDelete
 */
export default function TaskTable({
  tasks = [],
  activeFilter = 'all',
  onEdit,
  onDelete,
}) {
  if (tasks.length === 0) {
    return (
      <div className="empty-state">
        <h3>No tasks found</h3>
        <p>
          {activeFilter === 'all'
            ? 'You have not created any tasks yet. Click "Create Task" above to get started.'
            : `There are no tasks with status "${activeFilter}" on this page.`}
        </p>
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="task-table">
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Operation</th>
            <th scope="col">Status</th>
            <th scope="col">Created At</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const isPending = task.status === 'pending';

            return (
              <tr key={task.id}>
                <td className="task-title-cell" title={task.title}>
                  {task.title}
                </td>
                <td>
                  <span className="task-op-badge">{task.operation}</span>
                </td>
                <td>
                  <StatusBadge status={task.status} />
                </td>
                <td className="task-date-cell">
                  {formatDate(task.createdAt)}
                </td>
                <td>
                  <div className="table-actions">
                    <Link
                      to={`/tasks/${task.id}`}
                      className="btn-secondary btn-xs"
                      title="View task details"
                    >
                      View
                    </Link>

                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => onEdit(task)}
                      disabled={!isPending}
                      title={
                        isPending
                          ? 'Edit permitted fields'
                          : 'Only waiting tasks can be edited'
                      }
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => onDelete(task)}
                      title="Delete task"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

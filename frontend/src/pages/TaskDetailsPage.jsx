import { useParams, Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import TaskDetailsHeader from '../components/tasks/TaskDetailsHeader';
import TaskResult from '../components/tasks/TaskResult';
import LogViewer from '../components/tasks/LogViewer';
import { useTaskPolling } from '../hooks/useTaskPolling';
import '../styles/dashboard.css';

export default function TaskDetailsPage() {
  const { taskId } = useParams();
  const { task, logs, isLoading, error, isPolling, refetch } = useTaskPolling(taskId);

  return (
    <div className="dashboard-layout">
      <Navbar />

      <main className="dashboard-main">
        {isLoading && (
          <div className="empty-state">
            <p>Loading task details...</p>
          </div>
        )}

        {error && (
          <div className="dashboard-error-state" role="alert">
            <div>
              <strong>Error:</strong> {error}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-secondary btn-xs"
                onClick={refetch}
              >
                Retry
              </button>
              <Link to="/" className="btn-secondary btn-xs">
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}

        {!isLoading && task && (
          <>
            <TaskDetailsHeader task={task} isPolling={isPolling} />
            <TaskResult task={task} />
            <LogViewer logs={logs} />
          </>
        )}
      </main>
    </div>
  );
}

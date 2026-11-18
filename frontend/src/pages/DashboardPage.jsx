import { useState, useEffect, useCallback, useMemo } from 'react';
import Navbar from '../components/Navbar';
import TaskStats from '../components/tasks/TaskStats';
import TaskFilters from '../components/tasks/TaskFilters';
import TaskTable from '../components/tasks/TaskTable';
import Pagination from '../components/tasks/Pagination';
import TaskModal from '../components/tasks/TaskModal';
import ConfirmDeleteModal from '../components/tasks/ConfirmDeleteModal';
import taskApi from '../api/taskApi.js';
import { getErrorMessage } from '../api/client.js';
import '../styles/dashboard.css';

export default function DashboardPage() {
  const [tasks, setTasks] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    totalTasks: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');

  // Task creation/editing modal state
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalMode, setTaskModalMode] = useState('create');
  const [selectedTask, setSelectedTask] = useState(null);

  // Delete confirmation modal state
  const [taskToDelete, setTaskToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const fetchTasks = useCallback(async (targetPage = 1, signal) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await taskApi.getTasks({
        page: targetPage,
        limit: 10,
        signal,
      });

      const { tasks: fetchedTasks, pagination: fetchedPagination } =
        response.data.data;

      setTasks(fetchedTasks || []);
      setPagination(
        fetchedPagination || {
          page: targetPage,
          limit: 10,
          totalTasks: 0,
          totalPages: 0,
        }
      );
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') {
        return;
      }
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect
    fetchTasks(1, abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [fetchTasks]);

  function handlePageChange(newPage) {
    if (newPage < 1 || (pagination.totalPages > 0 && newPage > pagination.totalPages)) {
      return;
    }
    fetchTasks(newPage);
  }

  // Open modal in create mode
  function handleOpenCreateModal() {
    setTaskModalMode('create');
    setSelectedTask(null);
    setIsTaskModalOpen(true);
  }

  // Open modal in edit mode (only if pending)
  function handleOpenEditModal(task) {
    if (task.status !== 'pending') {
      return;
    }
    setTaskModalMode('edit');
    setSelectedTask(task);
    setIsTaskModalOpen(true);
  }

  // Handle successful create or edit
  function handleTaskMutationSuccess(_savedTask, message) {
    setIsTaskModalOpen(false);
    setSelectedTask(null);
    setSuccessMessage(message);

    // After creation, reload page 1 so the newly created task appears at top
    // After edit, reload current page
    const targetPage = taskModalMode === 'create' ? 1 : pagination.page;
    fetchTasks(targetPage);
  }

  // Open delete confirmation modal
  function handleOpenDeleteModal(task) {
    setTaskToDelete(task);
    setDeleteError(null);
  }

  // Execute delete after confirmation
  async function handleConfirmDelete() {
    if (!taskToDelete || isDeleting) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await taskApi.deleteTask(taskToDelete.id);
      setTaskToDelete(null);
      setSuccessMessage('Task deleted successfully');

      // If this was the only task on a page > 1, navigate to previous page
      const targetPage =
        tasks.length === 1 && pagination.page > 1
          ? pagination.page - 1
          : pagination.page;

      fetchTasks(targetPage);
    } catch (err) {
      setDeleteError(getErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  }

  // Filter tasks strictly on the currently loaded page
  const filteredTasks = useMemo(() => {
    if (activeFilter === 'all') return tasks;
    return tasks.filter((task) => task.status === activeFilter);
  }, [tasks, activeFilter]);

  return (
    <div className="dashboard-layout">
      <Navbar />

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1>Task Management</h1>
            <p>Monitor background processing tasks, operations, and execution logs.</p>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleOpenCreateModal}
          >
            Create Task
          </button>
        </header>

        {successMessage && (
          <div className="dashboard-success-state" role="status">
            <span>{successMessage}</span>
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => setSuccessMessage(null)}
              aria-label="Dismiss message"
            >
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="dashboard-error-state" role="alert">
            <span>Failed to load tasks: {error}</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fetchTasks(pagination.page)}
            >
              Retry
            </button>
          </div>
        )}

        <TaskStats
          totalTasks={pagination.totalTasks}
          currentPageTasks={tasks}
        />

        <TaskFilters
          activeFilter={activeFilter}
          onSelectFilter={setActiveFilter}
        />

        <div className="table-card">
          {isLoading ? (
            <div className="empty-state">
              <p>Loading tasks from server...</p>
            </div>
          ) : (
            <>
              <TaskTable
                tasks={filteredTasks}
                activeFilter={activeFilter}
                onEdit={handleOpenEditModal}
                onDelete={handleOpenDeleteModal}
              />

              {tasks.length > 0 && (
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  totalTasks={pagination.totalTasks}
                  limit={pagination.limit}
                  onPageChange={handlePageChange}
                  disabled={isLoading}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* Task Creation & Editing Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        mode={taskModalMode}
        task={selectedTask}
        onClose={() => {
          setIsTaskModalOpen(false);
          setSelectedTask(null);
        }}
        onSuccess={handleTaskMutationSuccess}
      />

      {/* Task Deletion Confirmation Dialog */}
      <ConfirmDeleteModal
        isOpen={Boolean(taskToDelete)}
        task={taskToDelete}
        isDeleting={isDeleting}
        error={deleteError}
        onClose={() => {
          if (!isDeleting) {
            setTaskToDelete(null);
            setDeleteError(null);
          }
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

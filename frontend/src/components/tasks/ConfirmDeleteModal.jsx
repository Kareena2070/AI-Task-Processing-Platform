import { useEffect } from 'react';
import AlertBanner from '../AlertBanner';

/**
 * Confirmation dialog before permanently deleting a task.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {object|null} props.task
 * @param {boolean} props.isDeleting
 * @param {string|null} props.error
 * @param {() => void} props.onClose
 * @param {() => void} props.onConfirm
 */
export default function ConfirmDeleteModal({
  isOpen,
  task = null,
  isDeleting = false,
  error = null,
  onClose,
  onConfirm,
}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen && !isDeleting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen || !task) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
      >
        <header className="modal-header">
          <h2 id="confirm-delete-title">Delete Task</h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Close dialog"
          >
            &times;
          </button>
        </header>

        <div className="modal-body">
          <AlertBanner message={error} />

          <p className="modal-delete-warning">
            Are you sure you want to delete task{' '}
            <strong>&ldquo;{task.title}&rdquo;</strong>? This action cannot be
            undone.
          </p>
        </div>

        <footer className="modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onConfirm}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Task'}
          </button>
        </footer>
      </div>
    </div>
  );
}

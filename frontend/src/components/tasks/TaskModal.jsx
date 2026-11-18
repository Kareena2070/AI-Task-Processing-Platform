import { useState, useEffect } from 'react';
import taskApi from '../../api/taskApi.js';
import { getErrorMessage } from '../../api/client.js';
import AlertBanner from '../AlertBanner';

const SUPPORTED_OPERATIONS = [
  { value: 'uppercase', label: 'Uppercase (Convert text to uppercase)' },
  { value: 'lowercase', label: 'Lowercase (Convert text to lowercase)' },
  { value: 'reverse_string', label: 'Reverse String (Reverse characters)' },
  { value: 'word_count', label: 'Word Count (Count whitespace-separated words)' },
];

const MAX_TITLE_LENGTH = 200;
const MAX_OPERATION_LENGTH = 100;

/**
 * TaskModal supports both creating a new task and editing permitted fields of a pending task.
 *
 * @param {object} props
 * @param {boolean} props.isOpen
 * @param {'create'|'edit'} props.mode
 * @param {object|null} props.task
 * @param {() => void} props.onClose
 * @param {(task: object, message: string) => void} props.onSuccess
 */
export default function TaskModal({
  isOpen,
  mode = 'create',
  task = null,
  onClose,
  onSuccess,
}) {
  const [title, setTitle] = useState('');
  const [operation, setOperation] = useState('uppercase');
  const [input, setInput] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEdit = mode === 'edit';

  // Initialize or reset form values when modal opens or task changes
  useEffect(() => {
    if (isOpen) {
      if (isEdit && task) {
        // oxlint-disable-next-line react/set-state-in-effect
        setTitle(task.title || '');
        setOperation(task.operation || 'uppercase');
        // Handle input whether it was formatted as an object or a raw string
        if (typeof task.input === 'object' && task.input !== null) {
          setInput(JSON.stringify(task.input, null, 2));
        } else {
          setInput(String(task.input || ''));
        }
      } else {
        // oxlint-disable-next-line react/set-state-in-effect
        setTitle('');
        setOperation('uppercase');
        setInput('');
      }
      setErrors({});
      setServerError(null);
      setIsSubmitting(false);
    }
  }, [isOpen, isEdit, task]);

  // Handle ESC key to dismiss modal
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  function validate() {
    const nextErrors = {};
    const trimmedTitle = title.trim();
    const trimmedOperation = operation.trim();
    const trimmedInput = input.trim();

    if (!trimmedTitle) {
      nextErrors.title = 'Task title is required';
    } else if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      nextErrors.title = `Task title cannot exceed ${MAX_TITLE_LENGTH} characters`;
    }

    if (!trimmedOperation) {
      nextErrors.operation = 'Task operation is required';
    } else if (trimmedOperation.length > MAX_OPERATION_LENGTH) {
      nextErrors.operation = `Task operation cannot exceed ${MAX_OPERATION_LENGTH} characters`;
    }

    if (!trimmedInput) {
      nextErrors.input = 'Task input is required';
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError(null);

    if (isSubmitting) return;

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        title: title.trim(),
        operation: operation.trim(),
        input: input.trim(),
      };

      if (isEdit && task) {
        // PATCH /api/tasks/:taskId - send only permitted fields
        const response = await taskApi.updateTask(task.id, payload);
        onSuccess(response.data.data.task, 'Task updated successfully');
      } else {
        // POST /api/tasks - send only authorized creation fields
        const response = await taskApi.createTask(payload);
        onSuccess(response.data.data.task, 'Task created successfully');
      }
    } catch (err) {
      setServerError(getErrorMessage(err));
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        // Close when clicking directly on backdrop
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-header">
          <h2 id="modal-title">
            {isEdit ? 'Edit Task' : 'Create New Task'}
          </h2>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            &times;
          </button>
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            <AlertBanner message={serverError} />

            <div className="form-field">
              <label htmlFor="task-title" className="form-label">
                Task Title
              </label>
              <input
                id="task-title"
                type="text"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) setErrors((prev) => ({ ...prev, title: null }));
                }}
                placeholder="e.g. Process customer records"
                maxLength={MAX_TITLE_LENGTH}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.title)}
                className={errors.title ? 'input-error-border' : ''}
                required
              />
              {errors.title && (
                <span className="field-error" role="alert">
                  {errors.title}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="task-operation" className="form-label">
                Operation
              </label>
              <select
                id="task-operation"
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value);
                  if (errors.operation) setErrors((prev) => ({ ...prev, operation: null }));
                }}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.operation)}
                className={errors.operation ? 'input-error-border' : ''}
                required
              >
                {SUPPORTED_OPERATIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
              {errors.operation && (
                <span className="field-error" role="alert">
                  {errors.operation}
                </span>
              )}
            </div>

            <div className="form-field">
              <label htmlFor="task-input" className="form-label">
                Input Payload
              </label>
              <textarea
                id="task-input"
                rows={4}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  if (errors.input) setErrors((prev) => ({ ...prev, input: null }));
                }}
                placeholder="Enter string content to process..."
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.input)}
                className={`form-textarea ${errors.input ? 'input-error-border' : ''}`}
                required
              />
              {errors.input && (
                <span className="field-error" role="alert">
                  {errors.input}
                </span>
              )}
            </div>
          </div>

          <footer className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? isEdit
                  ? 'Saving changes...'
                  : 'Creating task...'
                : isEdit
                ? 'Save Changes'
                : 'Create Task'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

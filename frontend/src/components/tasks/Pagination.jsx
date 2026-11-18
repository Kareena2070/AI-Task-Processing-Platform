/**
 * Pagination navigation bar for navigating server pages.
 *
 * @param {object} props
 * @param {number} props.page
 * @param {number} props.totalPages
 * @param {number} props.totalTasks
 * @param {number} props.limit
 * @param {(newPage: number) => void} props.onPageChange
 * @param {boolean} [props.disabled=false]
 */
export default function Pagination({
  page = 1,
  totalPages = 1,
  totalTasks = 0,
  limit = 10,
  onPageChange,
  disabled = false,
}) {
  const isFirstPage = page <= 1;
  const isLastPage = page >= totalPages || totalPages === 0;

  const startCount = totalTasks === 0 ? 0 : (page - 1) * limit + 1;
  const endCount = Math.min(page * limit, totalTasks);

  return (
    <footer className="pagination-bar" aria-label="Pagination Navigation">
      <span className="pagination-summary">
        Showing {startCount}–{endCount} of {totalTasks} task{totalTasks === 1 ? '' : 's'}
      </span>

      <div className="pagination-controls">
        <button
          type="button"
          className="btn-secondary pagination-btn"
          onClick={() => onPageChange(page - 1)}
          disabled={disabled || isFirstPage}
          aria-label="Previous page"
        >
          Previous
        </button>

        <span className="pagination-page-indicator">
          Page {page} of {Math.max(1, totalPages)}
        </span>

        <button
          type="button"
          className="btn-secondary pagination-btn"
          onClick={() => onPageChange(page + 1)}
          disabled={disabled || isLastPage}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </footer>
  );
}

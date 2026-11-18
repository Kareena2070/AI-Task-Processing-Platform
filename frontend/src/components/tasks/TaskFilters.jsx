const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Waiting' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * Filter controls operating strictly client-side on the currently loaded page of tasks.
 *
 * @param {object} props
 * @param {string} props.activeFilter
 * @param {(filter: string) => void} props.onSelectFilter
 */
export default function TaskFilters({ activeFilter, onSelectFilter }) {
  return (
    <div className="filters-container">
      <div className="filters-bar" role="group" aria-label="Task Status Filters">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`filter-btn ${activeFilter === option.value ? 'active' : ''}`}
            onClick={() => onSelectFilter(option.value)}
            aria-pressed={activeFilter === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="filters-notice">
        Filters apply strictly to the currently loaded page.
      </span>
    </div>
  );
}

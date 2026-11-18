/**
 * Simple alert banner for displaying server error or validation messages.
 *
 * @param {object} props
 * @param {string|null} props.message
 */
export default function AlertBanner({ message }) {
  if (!message) return null;

  return (
    <div className="alert-banner alert-banner-error" role="alert">
      {message}
    </div>
  );
}

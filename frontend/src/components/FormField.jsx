import { useState } from 'react';

/**
 * Accessible form field supporting standard text inputs and password visibility toggling.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.label
 * @param {string} [props.type="text"]
 * @param {string} props.value
 * @param {(e: React.ChangeEvent<HTMLInputElement>) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {string} [props.error]
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.autoComplete]
 * @param {boolean} [props.required=false]
 */
export default function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  disabled = false,
  autoComplete,
  required = false,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPasswordField = type === 'password';
  const effectiveType = isPasswordField ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="form-field">
      <div className="form-label-row">
        <label htmlFor={id} className="form-label">
          {label}
        </label>
      </div>

      <div className="input-wrapper">
        <input
          id={id}
          type={effectiveType}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`${error ? 'input-error-border' : ''} ${
            isPasswordField ? 'input-has-action' : ''
          }`}
        />

        {isPasswordField && (
          <button
            type="button"
            className="input-action-btn"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={0}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        )}
      </div>

      {error && (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

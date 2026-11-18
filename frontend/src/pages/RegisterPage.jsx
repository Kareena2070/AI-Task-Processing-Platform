import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../api/client';
import AuthLayout from '../components/AuthLayout';
import FormField from '../components/FormField';
import AlertBanner from '../components/AlertBanner';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 100;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate() {
    const nextErrors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      nextErrors.name = 'Full name is required';
    } else if (trimmedName.length < MIN_NAME_LENGTH || trimmedName.length > MAX_NAME_LENGTH) {
      nextErrors.name = `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters long`;
    }

    if (!trimmedEmail) {
      nextErrors.email = 'Email is required';
    } else if (!EMAIL_REGEX.test(trimmedEmail.toLowerCase())) {
      nextErrors.email = 'Please provide a valid email address';
    }

    if (!password) {
      nextErrors.password = 'Password is required';
    } else if (password.trim().length === 0) {
      nextErrors.password = 'Password cannot be whitespace only';
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
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
      await register(name.trim(), email.trim(), password);
      navigate('/', { replace: true });
    } catch (error) {
      setServerError(getErrorMessage(error));
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create an account"
      subtitle="Register to start creating and running background tasks."
      footerText="Already have an account?"
      footerLinkText="Sign in"
      footerLinkTo="/login"
    >
      <AlertBanner message={serverError} />

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <FormField
          id="register-name"
          label="Full name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors((prev) => ({ ...prev, name: null }));
          }}
          placeholder="Jane Doe"
          error={errors.name}
          disabled={isSubmitting}
          autoComplete="name"
          required
        />

        <FormField
          id="register-email"
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((prev) => ({ ...prev, email: null }));
          }}
          placeholder="name@example.com"
          error={errors.email}
          disabled={isSubmitting}
          autoComplete="email"
          required
        />

        <FormField
          id="register-password"
          label="Password (min. 8 characters)"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: null }));
          }}
          placeholder="Create a password"
          error={errors.password}
          disabled={isSubmitting}
          autoComplete="new-password"
          required
        />

        <button
          type="submit"
          className="btn-primary btn-block"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}

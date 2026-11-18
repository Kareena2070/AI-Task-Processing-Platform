import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getErrorMessage } from '../api/client';
import AuthLayout from '../components/AuthLayout';
import FormField from '../components/FormField';
import AlertBanner from '../components/AlertBanner';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function validate() {
    const nextErrors = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      nextErrors.email = 'Email is required';
    } else if (!EMAIL_REGEX.test(trimmedEmail.toLowerCase())) {
      nextErrors.email = 'Please provide a valid email address';
    }

    if (!password) {
      nextErrors.password = 'Password is required';
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
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (error) {
      setServerError(getErrorMessage(error));
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Sign in to your account"
      subtitle="Enter your email and password to access your tasks."
      footerText="Don't have an account?"
      footerLinkText="Register here"
      footerLinkTo="/register"
    >
      <AlertBanner message={serverError} />

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <FormField
          id="login-email"
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
          id="login-password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors((prev) => ({ ...prev, password: null }));
          }}
          placeholder="Enter your password"
          error={errors.password}
          disabled={isSubmitting}
          autoComplete="current-password"
          required
        />

        <button
          type="submit"
          className="btn-primary btn-block"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}

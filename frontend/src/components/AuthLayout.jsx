import { Link } from 'react-router-dom';
import '../styles/auth.css';

/**
 * Reusable layout wrapper for authentication screens.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.subtitle
 * @param {React.ReactNode} props.children
 * @param {string} props.footerText
 * @param {string} props.footerLinkText
 * @param {string} props.footerLinkTo
 */
export default function AuthLayout({
  title,
  subtitle,
  children,
  footerText,
  footerLinkText,
  footerLinkTo,
}) {
  return (
    <main className="auth-container">
      <div className="auth-card">
        <header className="auth-header">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </header>

        {children}

        {footerText && footerLinkText && footerLinkTo && (
          <footer className="auth-footer">
            <p>
              {footerText}{' '}
              <Link to={footerLinkTo}>{footerLinkText}</Link>
            </p>
          </footer>
        )}
      </div>
    </main>
  );
}

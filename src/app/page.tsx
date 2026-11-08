'use client';

import { useState, type FormEvent } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { SettingsLink } from '@/components/settings/SettingsLink';
import { useSettings } from '@/components/settings/SettingsProvider';

interface AuthResponse {
  userId: string;
  token: string;
  username?: string;
  avatar?: string | null;
  message?: string;
}

interface MessageResponse {
  message?: string;
  error?: string;
}

interface ApiError {
  message?: string;
  error?: string;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const router = useRouter();
  const { t, settings } = useSettings();

  function completeSignIn(response: AuthResponse, fallbackUsername: string) {
    if (!response.userId || !response.token) {
      throw new Error(t('authResponseMissing'));
    }

    localStorage.setItem('userId', response.userId);
    localStorage.setItem('authToken', response.token);
    localStorage.setItem('username', response.username || fallbackUsername);
    if (response.avatar) {
      localStorage.setItem('avatar', response.avatar);
    } else {
      localStorage.removeItem('avatar');
    }
    router.push('/chat');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      if (isForgotPassword) {
        await axios.post<MessageResponse>(`${API_URL}/api/password-reset/request`, {
          email: email.trim(),
        });
        setSuccessMessage(t('resetRequestConfirmation'));
        return;
      }

      const endpoint = isRegistering ? 'register' : 'login';
      if (isRegistering) {
        await axios.post<MessageResponse>(`${API_URL}/api/${endpoint}`, {
          username: username.trim(),
          email: email.trim(),
          password,
        });
        setPassword('');
        setSuccessMessage(t('verificationEmailSent'));
        return;
      }

      const response = await axios.post<AuthResponse>(`${API_URL}/api/${endpoint}`, {
        identifier: username.trim(),
        password,
      });

      completeSignIn(response.data, username.trim());
    } catch (error: unknown) {
      if (axios.isAxiosError<ApiError>(error)) {
        const apiMessage = error.response?.data?.message || error.response?.data?.error;
        const localizedApiMessages: Record<string, string> = {
          'Username already taken': t('usernameTaken'),
          'Email address is already registered': t('emailAlreadyRegistered'),
          'Email service is not configured': t('emailServiceNotConfigured'),
          'Verify your email address before signing in': t('verifyEmailBeforeSignIn'),
          'Username, email, and password are required': t('accountEmailPasswordRequired'),
          'Enter a valid email address': t('validEmailRequired'),
          'Password must be at least 8 characters and no more than 72 bytes': t('passwordTooShort'),
          'Could not send email. Check the email service configuration and try again.': t('emailDeliveryFailed'),
          'Invalid email, username, or password': t('invalidCredentials'),
          'Username and password are required': t('usernamePasswordRequired'),
          'Username must be 40 characters or fewer': t('usernameTooLong'),
        };
        const localizedApiMessage = apiMessage
          ? localizedApiMessages[apiMessage] || apiMessage
          : undefined;
        setErrorMessage(localizedApiMessage || (error.code === 'ERR_NETWORK'
          ? t('serverConnectionError')
          : t('signInError')));
      } else if (error instanceof Error) {
        setErrorMessage(error.message === 'The server did not return your account details. Please try again.'
          ? t('authResponseMissing')
          : error.message);
      } else {
        setErrorMessage(t('genericTryAgain'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn(credential?: string) {
    if (!credential || isSubmitting) {
      setErrorMessage(t('googleSignInFailed'));
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);
    try {
      const response = await axios.post<AuthResponse>(`${API_URL}/api/auth/google`, { credential });
      completeSignIn(response.data, '');
    } catch (error: unknown) {
      if (axios.isAxiosError<ApiError>(error)) {
        const apiMessage = error.response?.data?.error;
        setErrorMessage(apiMessage === 'Google sign-in is not configured'
          ? t('googleSignInUnavailable')
          : apiMessage === 'This email is linked to a different Google account'
            ? t('googleAccountConflict')
          : error.code === 'ERR_NETWORK'
            ? t('serverConnectionError')
            : t('googleSignInFailed'));
      } else if (error instanceof Error && error.message === t('authResponseMissing')) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(t('googleSignInFailed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function switchMode() {
    setIsRegistering((currentMode) => !currentMode);
    setIsForgotPassword(false);
    setErrorMessage('');
    setSuccessMessage('');
  }

  function startPasswordRecovery() {
    setIsForgotPassword(true);
    setErrorMessage('');
    setSuccessMessage('');
  }

  function returnToSignIn() {
    setIsForgotPassword(false);
    setErrorMessage('');
    setSuccessMessage('');
  }

  return (
    <main className="auth-page">
      <SettingsLink className="auth-settings-link" />
      <div className="auth-glow auth-glow-one" aria-hidden="true" />
      <div className="auth-glow auth-glow-two" aria-hidden="true" />

      <section className="auth-layout" aria-label={t('signInToWisal')}>
        <div className="auth-card">
          <Link className="brand brand-dark" href="/" aria-label={t('homeAria')}>
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" fill="none">
                <path
                  d="M7.5 9.5h17a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-6.5 4v-4h-1a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 16h.01M16 16h.01M20 16h.01"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span>Wisal</span>
          </Link>

          <div className="auth-heading">
            <span className="eyebrow">{t('yourSpaceStarts')}</span>
            <h1>
              {isForgotPassword
                ? t('forgotPassword')
                : isRegistering
                  ? t('createAccount')
                  : t('welcomeBack')}
            </h1>
            <p>
              {isForgotPassword
                ? t('forgotPasswordDescription')
                : isRegistering
                  ? t('createAccountDescription')
                  : t('signInDescription')}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {!isForgotPassword && (
              <>
                <label htmlFor="username">{isRegistering ? t('username') : t('loginIdentifier')}</label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder={isRegistering ? t('usernameExample') : t('loginIdentifierPlaceholder')}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                  maxLength={isRegistering ? 40 : 254}
                  disabled={isSubmitting}
                />
              </>
            )}

            {(isRegistering || isForgotPassword) && (
              <>
                <label htmlFor="email">{t('email')}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder={t('emailPlaceholder')}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={254}
                  disabled={isSubmitting}
                  dir="ltr"
                />
              </>
            )}

            {!isForgotPassword && (
              <>
                <div className="password-label">
                  <label htmlFor="password">{t('password')}</label>
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                  placeholder={t('passwordPlaceholder')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={isRegistering ? 8 : undefined}
                  maxLength={isRegistering ? 72 : undefined}
                  disabled={isSubmitting}
                  dir="ltr"
                />
                {isRegistering && <p className="password-help">{t('passwordMinimumLength')}</p>}
              </>
            )}

            {!isRegistering && !isForgotPassword && (
              <button
                className="forgot-password-link"
                type="button"
                onClick={startPasswordRecovery}
                disabled={isSubmitting}
              >
                {t('forgotPassword')}
              </button>
            )}

            {errorMessage && (
              <p className="form-error" id="auth-error" role="alert">
                <span aria-hidden="true">!</span>
                {errorMessage}
              </p>
            )}

            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  {isForgotPassword
                    ? t('sendingResetLink')
                    : isRegistering
                      ? t('createAccountProgress')
                      : t('signInProgress')}
                </>
              ) : (
                <>
                  {isForgotPassword
                    ? t('sendResetLink')
                    : isRegistering
                      ? t('createAccountAction')
                      : t('signIn')}
                  <span aria-hidden="true">{settings.language === 'ar' ? '→' : '←'}</span>
                </>
              )}
            </button>
          </form>

          {!isForgotPassword && GOOGLE_CLIENT_ID && (
            <div className="google-sign-in">
              <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <GoogleLogin
                  onSuccess={(credentialResponse) => void handleGoogleSignIn(credentialResponse.credential)}
                  onError={() => setErrorMessage(t('googleSignInFailed'))}
                  text={isRegistering ? 'signup_with' : 'continue_with'}
                  shape="rectangular"
                />
              </GoogleOAuthProvider>
            </div>
          )}

          {successMessage && (
            <p className="auth-success" role="status">
              {successMessage}
            </p>
          )}

          <p className="auth-switch">
            {isForgotPassword
              ? <button type="button" onClick={returnToSignIn} disabled={isSubmitting}>{t('backToSignIn')}</button>
              : <>
                  {isRegistering ? t('alreadyHaveAccount') : t('newToWisal')}
                  <button type="button" onClick={switchMode} disabled={isSubmitting}>
                    {isRegistering ? t('signIn') : t('createAccountAction')}
                  </button>
                </>}
          </p>

          <div className="auth-security">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 2.5 4 5v4.7c0 3.7 2.5 6.5 6 7.8 3.5-1.3 6-4.1 6-7.8V5l-6-2.5Z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="m7.5 9.8 1.7 1.7 3.4-3.6" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            {t('accountProtected')}
          </div>
        </div>

        <aside className="auth-showcase">
          <div className="showcase-orb orb-one" aria-hidden="true" />
          <div className="showcase-orb orb-two" aria-hidden="true" />
          <div className="showcase-grid" aria-hidden="true" />

          <div className="showcase-content">
            <span className="showcase-kicker">
              <span className="status-dot" />
              {t('closerConnections')}
            </span>
            <h2>
              {t('goodConversations')}
              <br />
              <span>{t('startWithWisal')}</span>
            </h2>
            <p>
              {t('authShowcaseDescription')}
            </p>

            <div className="showcase-preview" aria-hidden="true">
              <div className="preview-topbar">
                <span className="preview-avatar">S</span>
                <span className="preview-user">
                  <strong>Sam</strong>
                  <small>{t('onlineNow')}</small>
                </span>
                <span className="preview-dots">•••</span>
              </div>
              <div className="preview-messages">
                <span className="preview-message received">{t('previewMessageQuestion')}</span>
                <span className="preview-message sent">{t('previewMessageAnswer')}</span>
                <span className="preview-time">{t('now')}</span>
              </div>
              <div className="preview-input">
                <span>{t('writeMessage')}</span>
                <span className="preview-send">↑</span>
              </div>
            </div>
          </div>

          <div className="showcase-footer">
            <span>{t('connectWithEase')}</span>
            <span className="footer-line" />
            <span>{t('stayClose')}</span>
          </div>
        </aside>
      </section>

      <footer className="page-footer">
        <span>© {new Date().getFullYear()} Wisal</span>
        <span>{t('madeToBringCloser')}</span>
      </footer>
    </main>
  );
}

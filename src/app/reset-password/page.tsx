'use client';

import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { SettingsLink } from '@/components/settings/SettingsLink';
import { useSettings } from '@/components/settings/SettingsProvider';

interface ApiResponse {
  error?: string;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export default function ResetPasswordPage() {
  const { t } = useSettings();
  const [token, setToken] = useState('');
  const [isTokenLoaded, setIsTokenLoaded] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setToken(new URLSearchParams(window.location.search).get('token') || '');
      setIsTokenLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    if (password !== confirmPassword) {
      setErrorMessage(t('passwordsDoNotMatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      await axios.post(`${API_URL}/api/password-reset/confirm`, { token, password });
      setIsReset(true);
    } catch (error: unknown) {
      if (axios.isAxiosError<ApiResponse>(error)) {
        const apiError = error.response?.data?.error;
        setErrorMessage(
          apiError === 'This password reset link is invalid or has expired.'
            ? t('passwordResetFailed')
            : apiError === 'Password must be at least 8 characters and no more than 72 bytes'
              ? t('passwordTooShort')
              : error.code === 'ERR_NETWORK'
                ? t('serverConnectionError')
                : t('genericTryAgain'),
        );
      } else {
        setErrorMessage(t('genericTryAgain'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <SettingsLink className="auth-settings-link" />
      <section className="auth-layout auth-single-layout" aria-labelledby="reset-password-title">
        <div className="auth-card">
          <Link className="brand brand-dark" href="/" aria-label={t('homeAria')}>
            <span className="brand-mark" aria-hidden="true">W</span>
            <span>Wisal</span>
          </Link>
          <div className="auth-heading">
            <span className="eyebrow">{t('accountProtected')}</span>
            <h1 id="reset-password-title">{t('resetPassword')}</h1>
            <p>{t('resetPasswordDescription')}</p>
          </div>
          {isReset ? (
            <>
              <p className="auth-success" role="status">{t('passwordResetSuccess')}</p>
              <p className="auth-switch"><Link href="/">{t('backToSignIn')}</Link></p>
            </>
          ) : (
            <form className="auth-form" onSubmit={resetPassword}>
              {isTokenLoaded && !token && (
                <p className="form-error" role="alert">{t('passwordResetFailed')}</p>
              )}
              <label htmlFor="new-password">{t('newPassword')}</label>
              <input
                id="new-password"
                name="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                maxLength={72}
                required
                disabled={isSubmitting || !token}
                dir="ltr"
              />
              <label htmlFor="confirm-password">{t('confirmPassword')}</label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={72}
                required
                disabled={isSubmitting || !token}
                dir="ltr"
              />
              <p className="password-help">{t('passwordMinimumLength')}</p>
              {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
              <button className="primary-button" type="submit" disabled={!token || isSubmitting}>
                {isSubmitting ? t('resettingPassword') : t('resetPasswordAction')}
              </button>
              <p className="auth-switch"><Link href="/">{t('backToSignIn')}</Link></p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

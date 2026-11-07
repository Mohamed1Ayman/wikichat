'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { SettingsLink } from '@/components/settings/SettingsLink';
import { useSettings } from '@/components/settings/SettingsProvider';

interface ApiResponse {
  error?: string;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');

export default function VerifyEmailPage() {
  const { t } = useSettings();
  const [token, setToken] = useState('');
  const [isTokenLoaded, setIsTokenLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setToken(new URLSearchParams(window.location.search).get('token') || '');
      setIsTokenLoaded(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  async function verifyEmail() {
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await axios.post(`${API_URL}/api/verify-email`, { token });
      setIsVerified(true);
    } catch (error: unknown) {
      if (axios.isAxiosError<ApiResponse>(error)) {
        setErrorMessage(
          error.response?.data?.error === 'This verification link is invalid or has expired.'
            ? t('emailVerificationFailed')
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
      <section className="auth-layout auth-single-layout" aria-labelledby="verify-email-title">
        <div className="auth-card">
          <Link className="brand brand-dark" href="/" aria-label={t('homeAria')}>
            <span className="brand-mark" aria-hidden="true">W</span>
            <span>Wisal</span>
          </Link>
          <div className="auth-heading">
            <span className="eyebrow">{t('accountProtected')}</span>
            <h1 id="verify-email-title">{t('verifyEmail')}</h1>
            <p>{t('verifyEmailDescription')}</p>
          </div>
          {isVerified ? (
            <p className="auth-success" role="status">{t('emailVerificationSuccess')}</p>
          ) : (
            <>
              {isTokenLoaded && !token && (
                <p className="form-error" role="alert">{t('emailVerificationFailed')}</p>
              )}
              {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
              <button
                className="primary-button"
                type="button"
                onClick={verifyEmail}
                disabled={!token || isSubmitting}
              >
                {isSubmitting ? t('verifyingEmail') : t('verifyEmail')}
              </button>
              <p className="auth-switch">
                <Link href="/">{t('backToSignIn')}</Link>
              </p>
            </>
          )}
          {isVerified && (
            <p className="auth-switch">
              <Link href="/">{t('backToSignIn')}</Link>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

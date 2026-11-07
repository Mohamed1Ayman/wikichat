'use client';

import Link from 'next/link';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { SettingsControls } from '@/components/settings/SettingsControls';
import { ProfileSettings } from '@/components/settings/ProfileSettings';
import { LanguageControl } from '@/components/settings/LanguageControl';
import { useSettings } from '@/components/settings/SettingsProvider';

export default function SettingsPage() {
  const { t, settings } = useSettings();

  return (
    <main className="settings-page">
      <div className="settings-page-shell">
        <header className="settings-page-header">
          <Link className="brand brand-dark settings-page-brand" href="/" aria-label={t('homeAria')}>
            <span className="brand-mark" aria-hidden="true">
              <MessageCircle />
            </span>
            <span>Wisal</span>
          </Link>
          <Link className="settings-nav-link settings-page-nav-link" href="/chat">
            {settings.language === 'ar' && <ArrowLeft aria-hidden="true" />}
            {t('backToChat')}
            {settings.language === 'en' && <ArrowLeft aria-hidden="true" />}
          </Link>
        </header>

        <div className="settings-page-title-row">
          <span className="settings-page-icon" aria-hidden="true">
            <MessageCircle />
          </span>
          <div>
            <span className="settings-page-eyebrow">{t('settingsEyebrow')}</span>
            <h1 id="settings-page-title">{t('settingsTitle')}</h1>
            <p>{t('settingsDescription')}</p>
          </div>
        </div>

        <div className="settings-sections">
          <ProfileSettings />
          <LanguageControl />
          <SettingsControls />
        </div>
      </div>
    </main>
  );
}

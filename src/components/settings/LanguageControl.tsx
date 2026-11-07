'use client';

import { Languages } from 'lucide-react';
import { useSettings } from './SettingsProvider';

export function LanguageControl() {
  const { settings, updateSettings, t } = useSettings();

  return (
    <section className="settings-section-card language-settings-card" aria-labelledby="language-settings-title">
      <div className="settings-section-heading">
        <span className="settings-section-icon" aria-hidden="true">
          <Languages />
        </span>
        <div>
          <h2 id="language-settings-title">{t('language')}</h2>
          <p>{t('languageDescription')}</p>
        </div>
      </div>
      <div className="settings-language-options" role="group" aria-label={t('language')}>
        {(['en', 'ar'] as const).map((language) => (
          <button
            key={language}
            className={`settings-language-option ${settings.language === language ? 'is-selected' : ''}`}
            type="button"
            aria-pressed={settings.language === language}
            onClick={() => updateSettings((current) => ({ ...current, language }))}
          >
            <span className={`settings-language-code is-${language}`}>{language === 'en' ? 'EN' : 'ع'}</span>
            <span>{t(language === 'en' ? 'english' : 'arabic')}</span>
          </button>
        ))}
      </div>
      <p className="settings-language-note">{t('languageSavedNote')}</p>
    </section>
  );
}

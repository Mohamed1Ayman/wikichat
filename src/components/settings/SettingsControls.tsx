'use client';

import type { CSSProperties } from 'react';
import { Minus, Moon, Plus, Sun, Type } from 'lucide-react';
import { useSettings } from './SettingsProvider';

const MIN_FONT_SCALE = 0.85;
const MAX_FONT_SCALE = 1.3;
const FONT_SCALE_STEP = 0.05;

export function SettingsControls() {
  const { settings, updateSettings, t } = useSettings();
  const progress = ((settings.fontScale - MIN_FONT_SCALE) / (MAX_FONT_SCALE - MIN_FONT_SCALE)) * 100;

  return (
    <section className="settings-section-card settings-controls" aria-labelledby="appearance-settings-title">
      <div className="settings-section-heading">
        <span className="settings-section-icon" aria-hidden="true">
          <Sun />
        </span>
        <div>
          <h2 id="appearance-settings-title">{t('appearance')}</h2>
          <p>{t('appearanceDescription')}</p>
        </div>
      </div>
      <fieldset className="settings-theme-field">
        <legend>{t('theme')}</legend>
        <div className="settings-theme-options">
          <button
            type="button"
            className={`settings-theme-option ${settings.theme === 'light' ? 'is-selected' : ''}`}
            aria-pressed={settings.theme === 'light'}
            onClick={() => updateSettings((current) => ({ ...current, theme: 'light' }))}
          >
            <Sun aria-hidden="true" />
            <span>{t('light')}</span>
          </button>
          <button
            type="button"
            className={`settings-theme-option ${settings.theme === 'dark' ? 'is-selected' : ''}`}
            aria-pressed={settings.theme === 'dark'}
            onClick={() => updateSettings((current) => ({ ...current, theme: 'dark' }))}
          >
            <Moon aria-hidden="true" />
            <span>{t('dark')}</span>
          </button>
        </div>
      </fieldset>

      <div className="settings-font-control">
        <div className="settings-font-heading">
          <span className="settings-font-title">
            <Type aria-hidden="true" />
            {t('fontSize')}
          </span>
          <output htmlFor="settings-font-size">{Math.round(settings.fontScale * 100)}%</output>
        </div>
        <div className="settings-range-row">
          <Minus aria-hidden="true" />
          <input
            id="settings-font-size"
            aria-label={t('fontSizeAria')}
            type="range"
            min={MIN_FONT_SCALE}
            max={MAX_FONT_SCALE}
            step={FONT_SCALE_STEP}
            value={settings.fontScale}
            style={{ '--range-progress': `${progress}%` } as CSSProperties}
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                fontScale: Number(event.target.value),
              }))
            }
          />
          <Plus aria-hidden="true" />
        </div>
        <div className="settings-font-range-labels">
          <span>{t('smaller')}</span>
          <span>{t('larger')}</span>
        </div>
        <p className="settings-font-note">
          {t('mobileFontNote')}
        </p>
        <div className="settings-font-preview" aria-live="polite">
          <strong>{t('textPreview')}</strong>
          <span>{t('textPreviewDescription')}</span>
        </div>
      </div>
      <p className="settings-saved-note">{t('displaySavedNote')}</p>
    </section>
  );
}

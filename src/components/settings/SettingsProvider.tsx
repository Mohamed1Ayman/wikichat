'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { translate, type Language, type TranslationKey } from '@/lib/i18n';

export type Theme = 'light' | 'dark';

export interface SavedSettings {
  theme: Theme;
  fontScale: number;
  language: Language;
}

type SettingsUpdater = SavedSettings | ((current: SavedSettings) => SavedSettings);

interface SettingsContextValue {
  settings: SavedSettings;
  updateSettings: (updater: SettingsUpdater) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

const SETTINGS_STORAGE_KEY = 'wisal-settings';
const DEFAULT_SETTINGS: SavedSettings = { theme: 'light', fontScale: 1, language: 'en' };
const MIN_FONT_SCALE = 0.85;
const MAX_FONT_SCALE = 1.3;

let currentSettings = DEFAULT_SETTINGS;
let hasLoadedClientSettings = false;
const settingsListeners = new Set<() => void>();

function normalizeSavedSettings(value: unknown): SavedSettings | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const settings = value as Record<string, unknown>;
  if (
    (settings.theme === 'light' || settings.theme === 'dark') &&
    typeof settings.fontScale === 'number' &&
    settings.fontScale >= MIN_FONT_SCALE &&
    settings.fontScale <= MAX_FONT_SCALE
  ) {
    return {
      theme: settings.theme,
      fontScale: settings.fontScale,
      language: settings.language === 'ar' ? 'ar' : 'en',
    };
  }
  return null;
}

function readClientSettings() {
  if (typeof window === 'undefined' || hasLoadedClientSettings) {
    return currentSettings;
  }

  hasLoadedClientSettings = true;
  try {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      const normalized = normalizeSavedSettings(parsed);
      if (normalized) {
        currentSettings = normalized;
      }
    }
  } catch (error) {
    console.error('Could not load saved display settings.', error);
  }

  return currentSettings;
}

function getClientSnapshot() {
  return readClientSettings();
}

function getServerSnapshot() {
  return DEFAULT_SETTINGS;
}

function subscribeToSettings(listener: () => void) {
  settingsListeners.add(listener);

  function handleStorageChange(event: StorageEvent) {
    if (event.key !== SETTINGS_STORAGE_KEY && event.key !== null) {
      return;
    }

    hasLoadedClientSettings = false;
    readClientSettings();
    settingsListeners.forEach((notify) => notify());
  }

  window.addEventListener('storage', handleStorageChange);
  return () => {
    settingsListeners.delete(listener);
    window.removeEventListener('storage', handleStorageChange);
  };
}

function saveSettings(updater: SettingsUpdater) {
  const nextSettings = typeof updater === 'function' ? updater(readClientSettings()) : updater;
  currentSettings = nextSettings;
  hasLoadedClientSettings = true;

  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    console.error('Could not save display settings.', error);
  }

  settingsListeners.forEach((listener) => listener());
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const settings = useSyncExternalStore(subscribeToSettings, getClientSnapshot, getServerSnapshot);
  const updateSettings = useCallback((updater: SettingsUpdater) => saveSettings(updater), []);
  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      translate(key, settings.language, values),
    [settings.language],
  );
  const contextValue = useMemo(() => ({ settings, updateSettings, t }), [settings, t, updateSettings]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.language;
    document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.style.setProperty('--user-font-scale', String(settings.fontScale));
    document.title =
      settings.language === 'ar'
        ? 'وصال | تواصل أقرب، كل يوم'
        : 'Wisal | Closer connections, every day';
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) {
      description.content =
        settings.language === 'ar'
          ? 'وصال مساحة بسيطة للتواصل مع الأشخاص المهمين.'
          : 'Wisal is a simple space to connect with the people who matter.';
    }
  }, [settings]);

  return <SettingsContext.Provider value={contextValue}>{children}</SettingsContext.Provider>;
}

'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import axios from 'axios';
import { createAvatar } from '@dicebear/core';
import { adventurer, avataaars, bottts, lorelei, micah } from '@dicebear/collection';
import { Camera, Check, LoaderCircle, UserRound } from 'lucide-react';
import Image from 'next/image';
import { useSettings } from './SettingsProvider';
import type { TranslationKey } from '@/lib/i18n';

interface Profile {
  id: string;
  username: string;
  avatar: string | null;
  usernameChangedAt: string | null;
  nextUsernameChangeAt: string | null;
}

interface ApiError {
  error?: string;
  nextUsernameChangeAt?: string;
}

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024;
const AVATAR_NAMES = {
  Adventurer: 'avatarAdventurer',
  Avataaars: 'avatarAvataaars',
  Bottts: 'avatarBottts',
  Lorelei: 'avatarLorelei',
  Micah: 'avatarMicah',
} as const;
const PROFILE_ERROR_KEYS: Record<string, TranslationKey> = {
  'Sign in to manage your profile.': 'signInToManageProfile',
  'Please sign in again to continue': 'signInToManageProfile',
  'Sign in again before saving your profile.': 'signInAgainToSave',
  'Choose a valid image under 80 KB': 'imageTooLarge',
  'Choose a JPG, PNG, or WebP image.': 'validImage',
  'Choose an image smaller than 5 MB.': 'imageTooLarge',
  'Could not process this image. Try another one.': 'imageProcessingFailed',
  'Could not read this image. Try another one.': 'imageReadFailed',
  'This image is too large to use as a profile picture.': 'oversizedAvatar',
  'Username already taken': 'usernameTaken',
  'You can change your username again after the 20-day cooldown.': 'profileChangeCooldown',
  'Could not load your profile. Please try again.': 'loadProfileFailed',
  'Could not save your profile. Please try again.': 'saveProfileFailed',
};

function getToken() {
  return localStorage.getItem('authToken');
}

function toJpegDataUrl(source: string) {
  return new Promise<string>((resolve, reject) => {
    const image = document.createElement('img');
    image.onload = () => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not process this image. Try another one.'));
        return;
      }

      const cropSize = Math.min(image.naturalWidth, image.naturalHeight);
      const cropX = (image.naturalWidth - cropSize) / 2;
      const cropY = (image.naturalHeight - cropSize) / 2;
      for (const size of [256, 192, 128]) {
        canvas.width = size;
        canvas.height = size;
        context.clearRect(0, 0, size, size);
        context.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, size, size);
        for (const quality of [0.82, 0.68, 0.54, 0.4]) {
          const result = canvas.toDataURL('image/jpeg', quality);
          if (result.length <= 75_000) {
            resolve(result);
            return;
          }
        }
      }
      reject(new Error('This image is too large to use as a profile picture.'));
    };
    image.onerror = () => reject(new Error('Could not read this image. Try another one.'));
    image.src = source;
  });
}

function formatChangeDate(value: string, language: 'en' | 'ar') {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(date);
}

export function ProfileSettings() {
  const { t, settings } = useSettings();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [username, setUsername] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedAvatarName, setSelectedAvatarName] = useState<string | null>(null);
  const [canChangeUsername, setCanChangeUsername] = useState(false);
  const avatarChoices = useMemo(
    () => [
      { name: 'Adventurer', source: createAvatar(adventurer, { seed: 'Wisal', size: 96 }).toDataUri() },
      { name: 'Avataaars', source: createAvatar(avataaars, { seed: 'Wisal', size: 96 }).toDataUri() },
      { name: 'Bottts', source: createAvatar(bottts, { seed: 'Wisal', size: 96 }).toDataUri() },
      { name: 'Lorelei', source: createAvatar(lorelei, { seed: 'Wisal', size: 96 }).toDataUri() },
      { name: 'Micah', source: createAvatar(micah, { seed: 'Wisal', size: 96 }).toDataUri() },
    ],
    [],
  );
  const cooldownActive = !!profile?.nextUsernameChangeAt && !canChangeUsername;
  const localizedError = PROFILE_ERROR_KEYS[errorMessage]
    ? t(PROFILE_ERROR_KEYS[errorMessage])
    : errorMessage;
  const localizedSuccess = t(
    successMessage === 'Your profile has been updated.' ? 'profileSaved' : 'profileUnchanged',
  );

  useEffect(() => {
    let isActive = true;
    void (async () => {
      try {
        const token = getToken();
        if (!token) {
          throw new Error('Sign in to manage your profile.');
        }
        const { data } = await axios.get<Profile>(`${API_URL}/api/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!isActive) {
          return;
        }
        setProfile(data);
        setUsername(data.username);
        setAvatar(data.avatar);
        setSelectedAvatarName(null);
        setCanChangeUsername(
          !data.nextUsernameChangeAt || Date.parse(data.nextUsernameChangeAt) <= Date.now(),
        );
      } catch (error: unknown) {
        if (!isActive) {
          return;
        }
        const apiError = axios.isAxiosError<ApiError>(error) ? error.response?.data?.error : undefined;
        setErrorMessage(
          apiError
            ? apiError
            : error instanceof Error
              ? error.message
              : 'Could not load your profile. Please try again.',
        );
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    setErrorMessage('');
    setSuccessMessage('');
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMessage('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE) {
      setErrorMessage('Choose an image smaller than 5 MB.');
      return;
    }

    try {
      const source = URL.createObjectURL(file);
      try {
        setAvatar(await toJpegDataUrl(source));
        setSelectedAvatarName(null);
      } finally {
        URL.revokeObjectURL(source);
      }
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not process this image.');
    }
  }

  async function handleSave() {
    const token = getToken();
    if (!profile || !token) {
      setErrorMessage('Sign in again before saving your profile.');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      const updates: { username?: string; avatar?: string | null } = {};
      if (username.trim() !== profile.username) {
        updates.username = username.trim();
      }
      if (avatar !== profile.avatar) {
        updates.avatar = avatar ? await toJpegDataUrl(avatar) : null;
      }
      if (!Object.keys(updates).length) {
        setSuccessMessage('Your profile is already up to date.');
        return;
      }

      const { data } = await axios.patch<Profile>(`${API_URL}/api/profile`, updates, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setProfile(data);
      setUsername(data.username);
      setAvatar(data.avatar);
      setSelectedAvatarName(null);
      setCanChangeUsername(
        !data.nextUsernameChangeAt || Date.parse(data.nextUsernameChangeAt) <= Date.now(),
      );
      localStorage.setItem('username', data.username);
      if (data.avatar) {
        localStorage.setItem('avatar', data.avatar);
      } else {
        localStorage.removeItem('avatar');
      }
      window.dispatchEvent(new Event('storage'));
      setSuccessMessage('Your profile has been updated.');
    } catch (error: unknown) {
      if (axios.isAxiosError<ApiError>(error)) {
        const nextAllowedAt = error.response?.data?.nextUsernameChangeAt;
        if (nextAllowedAt && profile) {
          setProfile({ ...profile, nextUsernameChangeAt: nextAllowedAt });
        }
        setErrorMessage(error.response?.data?.error || 'Could not save your profile. Please try again.');
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Could not save your profile.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="settings-section-card profile-settings-section" aria-labelledby="profile-settings-title">
      <div className="settings-section-heading profile-settings-heading">
        <span className="settings-section-icon profile-settings-icon" aria-hidden="true">
          <UserRound />
        </span>
        <div>
          <h2 id="profile-settings-title">{t('profile')}</h2>
          <p>{t('profileDescription')}</p>
        </div>
      </div>

      {isLoading ? (
        <p className="profile-settings-state">
          <LoaderCircle aria-hidden="true" />
          {t('loadingProfile')}
        </p>
      ) : (
        <>
          <label className="profile-field-label" htmlFor="profile-username">
            {t('username')}
          </label>
          <input
            id="profile-username"
            className="profile-username-input"
            autoComplete="nickname"
            maxLength={40}
            value={username}
            disabled={!profile || cooldownActive}
            onChange={(event) => setUsername(event.target.value)}
          />
          {cooldownActive && profile?.nextUsernameChangeAt && (
            <p className="profile-cooldown-note">
              {t('usernameCooldown', {
                date:
                  formatChangeDate(profile.nextUsernameChangeAt, settings.language) || t('cooldownEnd'),
              })}
            </p>
          )}

          <div className="profile-avatar-heading">
            <span>{t('profilePicture')}</span>
            <label className="profile-upload-button">
              <Camera aria-hidden="true" />
              {t('uploadPhoto')}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => void handleUpload(event)}
                aria-label={t('uploadPhoto')}
              />
            </label>
          </div>
          <div className="profile-avatar-choices" aria-label={t('chooseAvatar')}>
            {avatarChoices.map((choice) => (
              <button
                key={choice.name}
                className={`profile-avatar-choice ${avatar === choice.source ? 'is-selected' : ''}`}
                type="button"
                aria-label={`${t('chooseAvatar')}: ${t(AVATAR_NAMES[choice.name as keyof typeof AVATAR_NAMES])}`}
                aria-pressed={avatar === choice.source}
                onClick={() => {
                  setAvatar(choice.source);
                  setSelectedAvatarName(choice.name);
                  setErrorMessage('');
                  setSuccessMessage('');
                }}
              >
                <Image src={choice.source} alt="" width={96} height={96} unoptimized />
                {selectedAvatarName === choice.name && <Check aria-hidden="true" />}
              </button>
            ))}
          </div>
          {avatar && (
            <div className="profile-current-avatar">
              <Image src={avatar} alt="" width={256} height={256} unoptimized />
              <span>{t('currentSelection')}</span>
            </div>
          )}

          {errorMessage && (
            <p className="profile-feedback is-error" role="alert">
              {localizedError}
            </p>
          )}
          {successMessage && (
            <p className="profile-feedback is-success" role="status">
              {localizedSuccess}
            </p>
          )}

          <button
            className="profile-save-button"
            type="button"
            disabled={!profile || isSaving || (!username.trim() && avatar === profile.avatar)}
            onClick={() => void handleSave()}
          >
            {isSaving && <LoaderCircle aria-hidden="true" />}
            {isSaving ? t('saving') : t('saveProfile')}
          </button>
        </>
      )}
    </section>
  );
}

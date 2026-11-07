'use client';

import { useEffect, useState } from 'react';
import { Forward, X } from 'lucide-react';
import type { ChatMessage, ChatUser } from './chat-types';
import { useSettings } from '@/components/settings/SettingsProvider';

interface ForwardMessageDialogProps {
  message: ChatMessage | null;
  users: ChatUser[];
  onClose: () => void;
  onForward: (message: ChatMessage, recipientIds: string[]) => void;
}

export function ForwardMessageDialog({ message, users, onClose, onForward }: ForwardMessageDialogProps) {
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([]);
  const { t } = useSettings();

  useEffect(() => {
    if (!message) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [message, onClose]);

  if (!message) {
    return null;
  }

  function toggleRecipient(userId: string) {
    setSelectedRecipientIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  return (
    <div className="delete-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    }}>
      <section
        className="delete-dialog forward-message-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forward-dialog-title"
        aria-describedby="forward-dialog-description"
      >
        <button className="delete-dialog-close" type="button" aria-label={t('close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
        <span className="forward-dialog-icon" aria-hidden="true">
          <Forward />
        </span>
        <h2 id="forward-dialog-title">{t('forwardMessage')}</h2>
        <p id="forward-dialog-description">{t('forwardDialogDescription')}</p>
        <blockquote className="forward-message-preview">{message.text}</blockquote>
        <div className="forward-recipient-list">
          {users.length === 0 ? (
            <p className="forward-empty-state">{t('noForwardRecipients')}</p>
          ) : (
            users.map((user) => {
              const isSelected = selectedRecipientIds.includes(user.id);
              return (
                <button
                  className={`forward-recipient ${isSelected ? 'is-selected' : ''}`}
                  key={user.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleRecipient(user.id)}
                >
                  <span className="forward-recipient-avatar" aria-hidden="true">
                    {user.username.charAt(0)}
                  </span>
                  <span>{user.username}</span>
                  <span className="forward-recipient-check" aria-hidden="true">
                    {isSelected ? '✓' : ''}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div className="delete-dialog-actions">
          <button className="delete-cancel-button" type="button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            className="forward-confirm-button"
            type="button"
            disabled={selectedRecipientIds.length === 0}
            onClick={() => onForward(message, selectedRecipientIds)}
          >
            {t('forward')}{selectedRecipientIds.length > 0 ? ` (${selectedRecipientIds.length})` : ''}
          </button>
        </div>
      </section>
    </div>
  );
}

'use client';

import { useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import { Check, CheckCheck, Forward, Pencil, Reply, Smile, Trash2 } from 'lucide-react';
import type { ChatMessage } from './chat-types';
import { useSettings } from '@/components/settings/SettingsProvider';

interface MessageItemProps {
  message: ChatMessage;
  isOwnMessage: boolean;
  currentUserId: string;
  replySenderName?: string;
  formatTime: (value: string) => string;
  onReply: (message: ChatMessage) => void;
  onReact: (messageId: string, emoji: string) => void;
  onForward: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
}

export function MessageItem({
  message,
  isOwnMessage,
  currentUserId,
  replySenderName,
  formatTime,
  onReply,
  onReact,
  onForward,
  onEdit,
  onDelete,
}: MessageItemProps) {
  const { t, settings } = useSettings();
  const [isReactionPickerOpen, setIsReactionPickerOpen] = useState(false);
  const [reactionPickerPosition, setReactionPickerPosition] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const reactionButtonRef = useRef<HTMLButtonElement>(null);
  const reactionPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isReactionPickerOpen) {
      return;
    }

    function handleOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        !reactionPickerRef.current?.contains(target) &&
        !reactionButtonRef.current?.contains(target)
      ) {
        setIsReactionPickerOpen(false);
      }
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, [isReactionPickerOpen]);

  useLayoutEffect(() => {
    if (!isReactionPickerOpen) {
      return;
    }

    function updateReactionPickerPosition() {
      const trigger = reactionButtonRef.current;
      if (!trigger) {
        return;
      }

      const viewportPadding = 12;
      const gap = 8;
      const width = Math.min(320, window.innerWidth - viewportPadding * 2);
      const height = Math.min(350, window.innerHeight - viewportPadding * 2);
      const triggerRect = trigger.getBoundingClientRect();
      const left = Math.max(
        viewportPadding,
        Math.min(
          triggerRect.left + triggerRect.width / 2 - width / 2,
          window.innerWidth - width - viewportPadding,
        ),
      );
      const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
      const spaceAbove = triggerRect.top - viewportPadding;
      let top: number;

      if (spaceBelow >= height + gap || spaceBelow >= spaceAbove) {
        top = Math.min(triggerRect.bottom + gap, window.innerHeight - height - viewportPadding);
      } else {
        top = Math.max(viewportPadding, triggerRect.top - height - gap);
      }

      setReactionPickerPosition({ top, left, width, height });
    }

    updateReactionPickerPosition();
    window.addEventListener('resize', updateReactionPickerPosition);
    window.addEventListener('scroll', updateReactionPickerPosition, true);
    return () => {
      window.removeEventListener('resize', updateReactionPickerPosition);
      window.removeEventListener('scroll', updateReactionPickerPosition, true);
    };
  }, [isReactionPickerOpen]);

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.changedTouches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const swipedTowardReply =
      settings.language === 'ar' ? deltaX > 64 : deltaX < -64;
    if (swipedTowardReply && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      onReply(message);
    }
  }

  function handleReaction(emoji: EmojiClickData) {
    onReact(message.id, emoji.emoji);
    setIsReactionPickerOpen(false);
  }

  return (
    <div
      className={`message-row ${isOwnMessage ? 'is-own-message' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="message-bubble">
        {message.forwarded && (
          <div className="forwarded-label">
            <Forward aria-hidden="true" />
            <span>
              {message.forwardedFrom
                ? t('forwardedFrom', { name: message.forwardedFrom })
                : t('forwarded')}
            </span>
          </div>
        )}
        {message.replyTo && (
          <div className="message-reply-quote">
            <strong>{replySenderName || t('messages')}</strong>
            <span>{message.replyTo.text}</span>
          </div>
        )}
        <p>{message.text}</p>
        <div className="message-actions">
          <button
            ref={reactionButtonRef}
            className="message-action-button"
            type="button"
            aria-label={t('reactToMessage')}
            title={t('reactToMessage')}
            aria-expanded={isReactionPickerOpen}
            onClick={() => setIsReactionPickerOpen((open) => !open)}
          >
            <Smile aria-hidden="true" />
          </button>
          <button
            className="message-action-button"
            type="button"
            aria-label={t('replyToMessage')}
            title={t('replySwipeHint')}
            onClick={() => onReply(message)}
          >
            <Reply aria-hidden="true" />
          </button>
          <button
            className="message-action-button"
            type="button"
            aria-label={t('forwardMessage')}
            title={t('forwardMessage')}
            onClick={() => onForward(message)}
          >
            <Forward aria-hidden="true" />
          </button>
          {isOwnMessage && (
            <>
              <button
                className="edit-message-button"
                type="button"
                aria-label={t('editMessage')}
                title={t('editMessage')}
                onClick={() => onEdit(message)}
              >
                <Pencil aria-hidden="true" />
              </button>
              <button
                className="delete-message-button"
                type="button"
                aria-label={t('deleteMessage')}
                title={t('deleteMessage')}
                onClick={() => onDelete(message)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        {message.reactions && message.reactions.length > 0 && (
          <div className="message-reactions" aria-label={t('reactToMessage')}>
            {message.reactions.map((reaction) => (
              <button
                className={`message-reaction ${reaction.users.includes(currentUserId) ? 'is-selected' : ''}`}
                key={reaction.emoji}
                type="button"
                aria-label={t(reaction.users.length === 1 ? 'reactionAriaOne' : 'reactionAria', {
                  emoji: reaction.emoji,
                  count: reaction.users.length,
                })}
                title={t(reaction.users.length === 1 ? 'reactionCountOne' : 'reactionCount', {
                  count: reaction.users.length,
                })}
                onClick={() => onReact(message.id, reaction.emoji)}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.users.length}</span>
              </button>
            ))}
          </div>
        )}
        <div className="message-meta">
          {message.edited && <span className="edited-label">{t('edited')}</span>}
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
          {isOwnMessage && (
            <span
              className={`message-status is-${message.status || 'sent'}`}
              aria-label={
                message.status === 'read'
                  ? t('read')
                  : message.status === 'delivered'
                    ? t('delivered')
                    : t('sent')
              }
              title={
                message.status === 'read'
                  ? t('read')
                  : message.status === 'delivered'
                    ? t('delivered')
                    : t('sent')
              }
            >
              {message.status === 'sent' || !message.status ? (
                <Check aria-hidden="true" />
              ) : (
                <CheckCheck aria-hidden="true" />
              )}
            </span>
          )}
        </div>
      </div>
      {isReactionPickerOpen &&
        reactionPickerPosition &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={reactionPickerRef}
            className="message-reaction-picker"
            style={{
              top: reactionPickerPosition.top,
              left: reactionPickerPosition.left,
              width: reactionPickerPosition.width,
              height: reactionPickerPosition.height,
            }}
          >
            <EmojiPicker
              onEmojiClick={handleReaction}
              width={reactionPickerPosition.width}
              height={reactionPickerPosition.height}
              lazyLoadEmojis
              previewConfig={{ showPreview: false }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

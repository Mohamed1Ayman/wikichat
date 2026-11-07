'use client';

import axios from 'axios';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import EmojiPicker, { type EmojiClickData } from 'emoji-picker-react';
import { ArrowLeft, Bell, LogOut, Menu, Send, Smile, Trash2, UserRoundCheck, UserRoundX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ForwardMessageDialog } from '@/components/chat/ForwardMessageDialog';
import { MessageItem } from '@/components/chat/MessageItem';
import { SettingsLink } from '@/components/settings/SettingsLink';
import { useSettings } from '@/components/settings/SettingsProvider';
import type { ChatMessage, ChatReaction, ChatUser, MessageStatus } from '@/components/chat/chat-types';
import type { Language, TranslationKey } from '@/lib/i18n';

type User = ChatUser;

interface ServerToClientEvents {
  receive_message: (message: ChatMessage) => void;
  message_sent: (message: ChatMessage) => void;
  message_edited: (message: ChatMessage) => void;
  message_reactions_updated: (event: { messageId: string; reactions: ChatReaction[] }) => void;
  chat_error: (event: { error: string }) => void;
  message_status: (event: { messageId: string; status: MessageStatus }) => void;
  online_users: (userIds: string[]) => void;
  user_status: (status: { userId: string; isOnline: boolean; lastSeen: string | null }) => void;
  profile_updated: (profile: { userId: string; username: string; avatar: string | null }) => void;
  user_typing: (event: { senderId: string }) => void;
  user_stopped_typing: (event: { senderId: string }) => void;
  conversation_deleted: (event: {
    userId: string;
    otherUserId: string;
    scope: 'me' | 'both';
    deletedBy: string;
  }) => void;
  message_deleted: (event: {
    messageId: string;
    userId: string;
    otherUserId: string;
    deletedBy: string;
    scope: 'me' | 'both';
  }) => void;
}

interface ClientToServerEvents {
  register_user: (userId: string) => void;
  send_message: (message: {
    senderId: string;
    receiverId: string;
    text: string;
    replyToMessageId?: string;
  }) => void;
  toggle_reaction: (event: { userId: string; messageId: string; emoji: string }) => void;
  forward_message: (event: { senderId: string; receiverId: string; messageId: string }) => void;
  edit_message: (message: { messageId: string; senderId: string; text: string }) => void;
  typing: (message: { senderId: string; receiverId: string }) => void;
  stop_typing: (message: { senderId: string; receiverId: string }) => void;
  message_delivered: (event: { messageId: string; receiverId: string }) => void;
  mark_messages_read: (event: { readerId: string; senderId: string }) => void;
}

interface IncomingNotification {
  userId: string;
  username: string;
  text: string;
}

const SESSION_LOADING = '__session_loading__';
const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/$/, '');

function subscribeToSession(onStoreChange: () => void) {
  window.addEventListener('storage', onStoreChange);
  return () => window.removeEventListener('storage', onStoreChange);
}

function getSessionUsername() {
  if (!localStorage.getItem('userId')) {
    return null;
  }

  return localStorage.getItem('username') || 'friend';
}

function getSessionUserId() {
  return localStorage.getItem('userId');
}

function getSessionAvatar() {
  return localStorage.getItem('avatar');
}

function subscribeToNotificationPermission(onStoreChange: () => void) {
  window.addEventListener('focus', onStoreChange);
  window.addEventListener('notificationpermissionchange', onStoreChange);
  return () => {
    window.removeEventListener('focus', onStoreChange);
    window.removeEventListener('notificationpermissionchange', onStoreChange);
  };
}

function getNotificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function formatMessageTime(value: string, language: Language) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatLastSeen(
  value: string | null,
  language: Language,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
) {
  if (!value) {
    return t('offline');
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t('offline');
  }

  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) {
    return t('lastSeenJustNow');
  }

  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (minutes < 60) {
    return t('lastSeen', { time: formatter.format(-minutes, 'minute') });
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('lastSeen', { time: formatter.format(-hours, 'hour') });
  }

  return t('lastSeen', { time: formatter.format(-Math.floor(hours / 24), 'day') });
}

export default function ChatPage() {
  const { t, settings } = useSettings();
  const username = useSyncExternalStore(subscribeToSession, getSessionUsername, () => SESSION_LOADING);
  const userId = useSyncExternalStore(subscribeToSession, getSessionUserId, () => SESSION_LOADING);
  const avatar = useSyncExternalStore(subscribeToSession, getSessionAvatar, () => null);
  const router = useRouter();
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const selectedUserRef = useRef<string | null>(null);
  const usersRef = useRef<User[]>([]);
  const editingMessageIdRef = useRef<string | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingRecipientRef = useRef<string | null>(null);
  const deleteCountdownTimerRef = useRef<number | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  const [users, setUsers] = useState<User[]>([]);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [messagesByUser, setMessagesByUser] = useState<Record<string, ChatMessage[]>>({});
  const [unreadByUser, setUnreadByUser] = useState<Record<string, number>>({});
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [notification, setNotification] = useState<IncomingNotification | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteScope, setDeleteScope] = useState<'me' | 'both' | null>(null);
  const [messageToDelete, setMessageToDelete] = useState<ChatMessage | null>(null);
  const [deleteCountdown, setDeleteCountdown] = useState(0);
  const [isDeleteCountdownActive, setIsDeleteCountdownActive] = useState(false);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [isOtherUserTyping, setIsOtherUserTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [replyToMessage, setReplyToMessage] = useState<ChatMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const notificationPermission = useSyncExternalStore(
    subscribeToNotificationPermission,
    getNotificationPermission,
    () => 'unsupported',
  );
  const messageListRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return;
    }

    function closeMenuOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !mobileMenuRef.current?.contains(event.target)) {
        setIsMobileMenuOpen(false);
      }
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
        mobileMenuButtonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', closeMenuOnOutsideClick);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [isMobileMenuOpen]);

  const fetchUsers = useCallback(async () => {
    if (!userId || userId === SESSION_LOADING) {
      return [];
    }

    const response = await axios.get<User[]>(`${API_URL}/api/users`);
    return response.data.filter((user) => user.id !== userId);
  }, [userId]);

  const loadUsers = useCallback(async () => {
    setIsLoadingUsers(true);
    setErrorMessage('');

    try {
      const otherUsers = await fetchUsers();
      usersRef.current = otherUsers;
      setUsers(otherUsers);
    } catch (error: unknown) {
      setErrorMessage(
        axios.isAxiosError(error)
          ? t('couldNotLoadUsers')
          : t('genericTryAgain'),
      );
    } finally {
      setIsLoadingUsers(false);
    }
  }, [fetchUsers, t]);

  useEffect(() => {
    if (username === null) {
      router.replace('/');
    }
  }, [router, username]);

  useEffect(() => {
    if (!notification) {
      return;
    }

    const timeout = window.setTimeout(() => setNotification(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  useEffect(() => {
    if (!isDeleteDialogOpen) {
      return;
    }

    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isDeletingConversation) {
        if (deleteCountdownTimerRef.current !== null) {
          window.clearInterval(deleteCountdownTimerRef.current);
          deleteCountdownTimerRef.current = null;
        }
        setIsDeleteCountdownActive(false);
        setDeleteCountdown(0);
        setIsDeleteDialogOpen(false);
        setDeleteScope(null);
        setMessageToDelete(null);
      }
    }

    window.addEventListener('keydown', handleDialogKeyDown);
    return () => window.removeEventListener('keydown', handleDialogKeyDown);
  }, [isDeleteDialogOpen, isDeletingConversation]);

  useEffect(
    () => () => {
      if (deleteCountdownTimerRef.current !== null) {
        window.clearInterval(deleteCountdownTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (userId === SESSION_LOADING || !userId) {
      return;
    }

    let isActive = true;

    function refreshUsers() {
      void fetchUsers()
        .then((otherUsers) => {
          if (!isActive) {
            return;
          }
          usersRef.current = otherUsers;
          setUsers(otherUsers);
        })
        .catch(() => {
          if (isActive) {
            setErrorMessage(t('couldNotLoadUsers'));
          }
        })
        .finally(() => {
          if (isActive) {
            setIsLoadingUsers(false);
          }
        });
    }

    refreshUsers();
    const refreshInterval = window.setInterval(refreshUsers, 15000);
    return () => {
      isActive = false;
      window.clearInterval(refreshInterval);
    };
  }, [fetchUsers, t, userId]);

  useEffect(() => {
    if (userId === SESSION_LOADING || !userId) {
      return;
    }

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('register_user', userId);
    });

    socket.on('disconnect', () => setIsConnected(false));
    socket.on('connect_error', () => setIsConnected(false));
    socket.on('chat_error', ({ error }) => {
      setErrorMessage(error);
      setIsSending(false);
    });
    socket.on('online_users', (userIds) => setOnlineUsers(new Set(userIds)));
    socket.on('user_status', (status) => {
      usersRef.current = usersRef.current.map((user) =>
        user.id === status.userId
          ? { ...user, isOnline: status.isOnline, lastSeen: status.lastSeen }
          : user,
      );
      setUsers(usersRef.current);
    });
    socket.on('profile_updated', (profile) => {
      if (profile.userId === userId) {
        localStorage.setItem('username', profile.username);
        if (profile.avatar) {
          localStorage.setItem('avatar', profile.avatar);
        } else {
          localStorage.removeItem('avatar');
        }
        window.dispatchEvent(new Event('storage'));
      }

      usersRef.current = usersRef.current.map((user) =>
        user.id === profile.userId
          ? { ...user, username: profile.username, avatar: profile.avatar }
          : user,
      );
      setUsers(usersRef.current);
      setSelectedUser((current) =>
        current?.id === profile.userId
          ? { ...current, username: profile.username, avatar: profile.avatar }
          : current,
      );
    });

    socket.on('user_typing', ({ senderId }) => {
      if (selectedUserRef.current !== senderId) {
        return;
      }

      setIsOtherUserTyping(true);
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = window.setTimeout(() => setIsOtherUserTyping(false), 2200);
    });

    socket.on('user_stopped_typing', ({ senderId }) => {
      if (selectedUserRef.current === senderId) {
        setIsOtherUserTyping(false);
        if (typingTimeoutRef.current !== null) {
          window.clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = null;
        }
      }
    });

    socket.on('receive_message', (message) => {
      if (message.receiver !== userId) {
        return;
      }

      socket.emit('message_delivered', { messageId: message.id, receiverId: userId });
      setMessagesByUser((current) => ({
        ...current,
        [message.sender]: [...(current[message.sender] || []), message],
      }));

      const isConversationOpen = selectedUserRef.current === message.sender;
      if (!isConversationOpen) {
        setUnreadByUser((current) => ({
          ...current,
          [message.sender]: (current[message.sender] || 0) + 1,
        }));
      } else if (document.visibilityState === 'visible') {
        socket.emit('mark_messages_read', { readerId: userId, senderId: message.sender });
      }

      const sender = usersRef.current.find((user) => user.id === message.sender);
      const incomingNotification = {
        userId: message.sender,
        username: sender?.username || 'New user',
        text: message.text,
      };
      setNotification(incomingNotification);

      if (
        document.visibilityState === 'hidden' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        const browserNotification = new Notification(`New message from ${incomingNotification.username}`, {
          body: message.text,
          tag: `message-${message.sender}`,
        });
        browserNotification.onclick = () => window.focus();
      }
    });

    socket.on('message_sent', (message) => {
      setMessagesByUser((current) => ({
        ...current,
        [message.receiver]: [...(current[message.receiver] || []), message],
      }));
      setIsSending(false);
    });

    socket.on('message_edited', (message) => {
      const peerId = message.sender === userId ? message.receiver : message.sender;
      setMessagesByUser((current) => ({
        ...current,
        [peerId]: (current[peerId] || []).map((item) => (item.id === message.id ? message : item)),
      }));
      if (editingMessageIdRef.current === message.id) {
        editingMessageIdRef.current = null;
        setEditingMessageId(null);
        setDraft('');
        setIsSending(false);
      }
    });

    socket.on('message_reactions_updated', ({ messageId, reactions }) => {
      setMessagesByUser((current) => {
        const peerId = Object.keys(current).find((key) =>
          current[key].some((message) => message.id === messageId),
        );
        if (!peerId) {
          return current;
        }

        return {
          ...current,
          [peerId]: current[peerId].map((message) =>
            message.id === messageId ? { ...message, reactions } : message,
          ),
        };
      });
    });

    socket.on('message_status', ({ messageId, status }) => {
      setMessagesByUser((current) => {
        const peerId = Object.keys(current).find((key) =>
          current[key].some((message) => message.id === messageId && message.sender === userId),
        );
        if (!peerId) {
          return current;
        }

        return {
          ...current,
          [peerId]: current[peerId].map((message) =>
            message.id === messageId ? { ...message, status } : message,
          ),
        };
      });
    });

    socket.on('conversation_deleted', (event) => {
      if (event.scope !== 'both' || event.deletedBy === userId) {
        return;
      }

      const peerId = event.userId === userId ? event.otherUserId : event.userId;
      setMessagesByUser((current) => ({ ...current, [peerId]: [] }));
      setUnreadByUser((current) => ({ ...current, [peerId]: 0 }));
    });

    socket.on('message_deleted', ({ messageId, userId: deletingUserId, otherUserId, deletedBy, scope }) => {
      if (scope === 'me' && deletedBy !== userId) {
        return;
      }

      const peerId = deletingUserId === userId ? otherUserId : deletingUserId;
      setMessagesByUser((current) => ({
        ...current,
        [peerId]: (current[peerId] || []).filter((message) => message.id !== messageId),
      }));
    });

    return () => {
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (userId === SESSION_LOADING || !userId) {
      return;
    }

    const currentUserId = userId;
    function markOpenConversationRead() {
      const senderId = selectedUserRef.current;
      if (document.visibilityState === 'visible' && senderId && socketRef.current?.connected) {
        socketRef.current.emit('mark_messages_read', { readerId: currentUserId, senderId });
      }
    }

    document.addEventListener('visibilitychange', markOpenConversationRead);
    return () => document.removeEventListener('visibilitychange', markOpenConversationRead);
  }, [userId]);

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messagesByUser, selectedUser]);

  useEffect(() => {
    if (!isOtherUserTyping) {
      return;
    }

    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [isOtherUserTyping]);

  async function openConversation(user: User) {
    if (!userId || userId === SESSION_LOADING) {
      return;
    }

    if (typingRecipientRef.current && socketRef.current?.connected) {
      socketRef.current.emit('stop_typing', {
        senderId: userId,
        receiverId: typingRecipientRef.current,
      });
    }
    typingRecipientRef.current = null;
    selectedUserRef.current = user.id;
    setSelectedUser(user);
    setIsOtherUserTyping(false);
    editingMessageIdRef.current = null;
    setEditingMessageId(null);
    setReplyToMessage(null);
    setForwardingMessage(null);
    setIsEmojiPickerOpen(false);
    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setUnreadByUser((current) => ({ ...current, [user.id]: 0 }));
    setErrorMessage('');

    try {
      const response = await axios.get<ChatMessage[]>(
        `${API_URL}/api/messages/${encodeURIComponent(userId)}/${encodeURIComponent(user.id)}`,
      );
      setMessagesByUser((current) => ({ ...current, [user.id]: response.data }));
      if (document.visibilityState === 'visible' && socketRef.current?.connected) {
        socketRef.current.emit('mark_messages_read', { readerId: userId, senderId: user.id });
      }
    } catch {
      setErrorMessage(t('couldNotLoadMessages'));
    }
  }

  async function performDeletion() {
    if (!selectedUser || !userId || userId === SESSION_LOADING || !deleteScope || isDeletingConversation) {
      return;
    }

    setIsDeletingConversation(true);
    setErrorMessage('');

    try {
      const token = localStorage.getItem('authToken');
      if (!token) {
        throw new Error(t('expiredDeleteSession'));
      }

      const conversationUrl = `${API_URL}/api/messages/${encodeURIComponent(userId)}/${encodeURIComponent(selectedUser.id)}`;
      await axios.delete(
        messageToDelete
          ? `${conversationUrl}/${encodeURIComponent(messageToDelete.id)}`
          : conversationUrl,
        {
          data: { scope: deleteScope },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (messageToDelete) {
        setMessagesByUser((current) => ({
          ...current,
          [selectedUser.id]: (current[selectedUser.id] || []).filter(
            (message) => message.id !== messageToDelete.id,
          ),
        }));
      } else {
        setMessagesByUser((current) => ({ ...current, [selectedUser.id]: [] }));
        setUnreadByUser((current) => ({ ...current, [selectedUser.id]: 0 }));
      }

      setDeleteScope(null);
      setMessageToDelete(null);
      setIsDeleteDialogOpen(false);
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error && !axios.isAxiosError(error)
          ? error.message
          : axios.isAxiosError(error)
            ? error.response?.data?.error || t('deleteError')
            : t('deleteUnexpectedError'),
      );
    } finally {
      setIsDeletingConversation(false);
    }
  }

  function startDeleteCountdown() {
    if (!deleteScope || isDeletingConversation || isDeleteCountdownActive) {
      return;
    }

    setErrorMessage('');
    setDeleteCountdown(3);
    setIsDeleteCountdownActive(true);
    let remaining = 3;
    deleteCountdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setDeleteCountdown(remaining);
      if (remaining === 0) {
        if (deleteCountdownTimerRef.current !== null) {
          window.clearInterval(deleteCountdownTimerRef.current);
          deleteCountdownTimerRef.current = null;
        }
        setIsDeleteCountdownActive(false);
        void performDeletion();
      }
    }, 1000);
  }

  function cancelDeleteCountdown(closeDialog = false) {
    if (deleteCountdownTimerRef.current !== null) {
      window.clearInterval(deleteCountdownTimerRef.current);
      deleteCountdownTimerRef.current = null;
    }
    setIsDeleteCountdownActive(false);
    setDeleteCountdown(0);
    if (closeDialog) {
      setIsDeleteDialogOpen(false);
      setDeleteScope(null);
      setMessageToDelete(null);
    }
  }

  function openMessageDeleteDialog(message: ChatMessage) {
    if (!selectedUser || message.sender !== userId) {
      return;
    }

    setMessageToDelete(message);
    setDeleteScope(null);
    setErrorMessage('');
    setIsDeleteDialogOpen(true);
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    setIsEmojiPickerOpen(false);

    if (editingMessageId || !selectedUser || !userId || userId === SESSION_LOADING || !socketRef.current?.connected) {
      return;
    }

    if (!value.trim()) {
      socketRef.current.emit('stop_typing', { senderId: userId, receiverId: selectedUser.id });
      typingRecipientRef.current = null;
      return;
    }

    socketRef.current.emit('typing', { senderId: userId, receiverId: selectedUser.id });
    typingRecipientRef.current = selectedUser.id;
  }

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();

    if (!text || !selectedUser || !userId || userId === SESSION_LOADING || isSending) {
      return;
    }

    if (!socketRef.current?.connected) {
      setErrorMessage(t('serverUnavailable'));
      return;
    }

    setErrorMessage('');
    setIsSending(true);
    if (editingMessageId) {
      socketRef.current.emit('edit_message', {
        messageId: editingMessageId,
        senderId: userId,
        text,
      });
      return;
    }

    socketRef.current.emit('stop_typing', { senderId: userId, receiverId: selectedUser.id });
    typingRecipientRef.current = null;
    setDraft('');
    const replyToMessageId = replyToMessage?.id;
    setReplyToMessage(null);
    socketRef.current.emit('send_message', {
      senderId: userId,
      receiverId: selectedUser.id,
      text,
      ...(replyToMessageId ? { replyToMessageId } : {}),
    });
  }

  function startEditingMessage(message: ChatMessage) {
    editingMessageIdRef.current = message.id;
    setEditingMessageId(message.id);
    setReplyToMessage(null);
    setDraft(message.text);
    setIsEmojiPickerOpen(false);
  }

  function cancelEditingMessage() {
    editingMessageIdRef.current = null;
    setEditingMessageId(null);
    setDraft('');
    setIsSending(false);
  }

  function reactToMessage(messageId: string, emoji: string) {
    if (!userId || userId === SESSION_LOADING || !socketRef.current?.connected) {
      setErrorMessage(t('serverUnavailable'));
      return;
    }

    socketRef.current.emit('toggle_reaction', { userId, messageId, emoji });
  }

  function forwardMessage(message: ChatMessage, recipientIds: string[]) {
    if (!userId || userId === SESSION_LOADING || !socketRef.current?.connected) {
      setErrorMessage(t('serverUnavailable'));
      return;
    }

    recipientIds.forEach((receiverId) => {
      socketRef.current?.emit('forward_message', {
        senderId: userId,
        receiverId,
        messageId: message.id,
      });
    });
    setForwardingMessage(null);
  }

  function replyToChatMessage(message: ChatMessage) {
    setReplyToMessage(message);
    if (editingMessageId) {
      cancelEditingMessage();
    }
    window.setTimeout(() => messageInputRef.current?.focus(), 0);
  }

  function appendEmoji(emoji: string) {
    handleDraftChange(`${draft}${emoji}`);
  }

  function handleEmojiClick(emoji: EmojiClickData) {
    appendEmoji(emoji.emoji);
  }

  async function enableNotifications() {
    await Notification.requestPermission();
    window.dispatchEvent(new Event('notificationpermissionchange'));
  }

  function handleLogout() {
    socketRef.current?.disconnect();
    localStorage.removeItem('userId');
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    localStorage.removeItem('avatar');
    router.replace('/');
  }

  if (username === null || username === SESSION_LOADING || userId === SESSION_LOADING) {
    return (
      <main className="session-loading" aria-label={t('checkingAccount')}>
        <span className="button-spinner" aria-hidden="true" />
      </main>
    );
  }

  const filteredUsers = users.filter((user) => user.username.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const onlineUserCount = users.filter((user) => onlineUsers.has(user.id)).length;
  const offlineUserCount = users.length - onlineUserCount;
  const selectedMessages = selectedUser ? messagesByUser[selectedUser.id] || [] : [];

  return (
    <main className="workspace-page">
      {isDeleteDialogOpen && selectedUser && (
        <div
          className="delete-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingConversation) {
              cancelDeleteCountdown(true);
            }
          }}
        >
          <section
            className="delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            aria-describedby="delete-dialog-description"
          >
            <button
              className="delete-dialog-close"
              type="button"
              aria-label={t('close')}
              disabled={isDeletingConversation}
              onClick={() => cancelDeleteCountdown(true)}
            >
              ×
            </button>
            <span className="delete-dialog-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2 id="delete-dialog-title">
              {messageToDelete ? t('deleteMessage') : t('deleteConversation')}
            </h2>
            <p id="delete-dialog-description">
              {messageToDelete
                ? t('messageDeleteDescription', { name: selectedUser.username })
                : t('chooseDeleteConversation', { name: selectedUser.username })}
            </p>

            <div className="delete-scope-options">
              <button
                type="button"
                className={`delete-scope-option ${deleteScope === 'me' ? 'is-selected' : ''}`}
                disabled={isDeletingConversation || isDeleteCountdownActive}
                onClick={() => setDeleteScope('me')}
                aria-pressed={deleteScope === 'me'}
              >
                <span className="delete-scope-radio" aria-hidden="true" />
                <span>
                  <strong>{t('onlyForMe')}</strong>
                  <small>
                    {messageToDelete
                      ? t('messageRemainsForOther')
                      : t('conversationRemainsForOther')}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className={`delete-scope-option ${deleteScope === 'both' ? 'is-selected' : ''}`}
                disabled={isDeletingConversation || isDeleteCountdownActive || (messageToDelete !== null && messageToDelete.sender !== userId)}
                onClick={() => setDeleteScope('both')}
                aria-pressed={deleteScope === 'both'}
              >
                <span className="delete-scope-radio" aria-hidden="true" />
                <span>
                  <strong>{t('forEveryone')}</strong>
                  <small>
                    {messageToDelete
                      ? t('messageRemovedForBoth')
                      : t('messagesRemovedForBoth')}
                  </small>
                </span>
              </button>
            </div>

            {deleteScope === 'both' && !isDeleteCountdownActive && (
              <p className="delete-warning" role="status">
                {messageToDelete
                  ? t('messageRemovedParticipants')
                  : t('countdownCannotUndo')}
              </p>
            )}
            {isDeleteCountdownActive && (
              <p className="delete-warning delete-countdown" role="status" aria-live="assertive">
                {t('deletingIn', { count: deleteCountdown })}
              </p>
            )}
            {errorMessage && (
              <p className="delete-warning" role="alert">
                {errorMessage}
              </p>
            )}

            <div className={`delete-dialog-actions ${isDeleteCountdownActive ? 'is-counting-down' : ''}`}>
              <button
                className="delete-cancel-button"
                type="button"
                disabled={isDeletingConversation}
                onClick={() => cancelDeleteCountdown(true)}
              >
                {t('cancel')}
              </button>
              {isDeleteCountdownActive && (
                <button
                  className="delete-undo-button"
                  type="button"
                  onClick={() => cancelDeleteCountdown()}
                >
                  {t('undo')}
                </button>
              )}
              <button
                className="delete-confirm-button"
                type="button"
                disabled={!deleteScope || isDeletingConversation || isDeleteCountdownActive}
                onClick={startDeleteCountdown}
              >
                {isDeletingConversation
                  ? t('deleting')
                  : isDeleteCountdownActive
                    ? t('deleteIn', { count: deleteCountdown })
                    : messageToDelete
                      ? t('deleteMessage')
                      : t('deleteConversation')}
              </button>
            </div>
          </section>
        </div>
      )}

      <ForwardMessageDialog
        key={forwardingMessage?.id || 'no-forward-message'}
        message={forwardingMessage}
        users={users}
        onClose={() => setForwardingMessage(null)}
        onForward={forwardMessage}
      />

      {notification && (
        <div className="message-toast" role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <button
            type="button"
            className="toast-copy"
            onClick={() => {
              const sender = usersRef.current.find((user) => user.id === notification.userId);
              if (sender) {
                void openConversation(sender);
              }
              setNotification(null);
            }}
          >
            <strong>
              {t('newMessageFrom', {
                name: notification.username === 'New user' ? t('newUser') : notification.username,
              })}
            </strong>
            <span>{notification.text}</span>
          </button>
          <button
            className="toast-close"
            type="button"
            aria-label={t('closeNotification')}
            onClick={() => setNotification(null)}
          >
            ×
          </button>
        </div>
      )}

      <header className="workspace-header">
        <Link className="brand brand-dark" href="/" aria-label="Wisal">
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

        <div className="workspace-header-actions">
          <SettingsLink className="workspace-settings-link" />
          {notificationPermission === 'default' && (
            <Button className="notification-enable" variant="outline" type="button" onClick={enableNotifications}>
              <Bell aria-hidden="true" />
              <span>{t('enableNotifications')}</span>
            </Button>
          )}
          {notificationPermission === 'denied' && (
            <span className="notification-hint">{t('notificationsBlocked')}</span>
          )}
          <span className={`connection-indicator ${isConnected ? 'is-connected' : ''}`}>
            <span className="status-dot" />
            {isConnected ? t('connected') : t('disconnected')}
          </span>
          <div className="workspace-user">
            <span className="user-avatar" aria-hidden="true">
              {avatar ? (
                <Image className="avatar-image" src={avatar} alt="" width={34} height={34} unoptimized />
              ) : (
                username.charAt(0)
              )}
            </span>
            <span className="workspace-username">{username}</span>
            <Button className="logout-button" variant="outline" size="sm" type="button" onClick={handleLogout}>
              <LogOut aria-hidden="true" />
              <span>{t('signOut')}</span>
            </Button>
          </div>
          <div className="workspace-mobile-menu" ref={mobileMenuRef}>
            <Button
              ref={mobileMenuButtonRef}
              className="mobile-menu-toggle"
              variant="outline"
              type="button"
              aria-label={t(isMobileMenuOpen ? 'closeMenu' : 'openMenu')}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-account-menu"
              onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
            >
              {isMobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </Button>
            <nav
              id="mobile-account-menu"
              className={`mobile-account-menu ${isMobileMenuOpen ? 'is-open' : ''}`}
              aria-label={t('accountMenu')}
              inert={!isMobileMenuOpen}
            >
              <SettingsLink
                className="mobile-menu-settings-link"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              <button
                className="mobile-menu-logout"
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleLogout();
                }}
              >
                <LogOut aria-hidden="true" />
                <span>{t('signOut')}</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      <section className={`workspace-layout ${selectedUser ? 'has-selected-conversation' : ''}`} aria-label={t('chatWorkspace')}>
        <aside className={`conversation-sidebar ${selectedUser ? 'is-mobile-hidden' : ''}`}>
          <div className="sidebar-heading">
            <div>
              <span className="eyebrow">{t('connectCommunity')}</span>
              <h1>{t('messages')}</h1>
            </div>
          </div>

          <div className="presence-summary" aria-label={t('peopleByAvailability')}>
            <div className="presence-summary-item is-online">
              <UserRoundCheck aria-hidden="true" />
              <span>{t('onlineNow')}</span>
              <strong>{onlineUserCount}</strong>
            </div>
            <div className="presence-summary-item is-offline">
              <UserRoundX aria-hidden="true" />
              <span>{t('offline')}</span>
              <strong>{offlineUserCount}</strong>
            </div>
          </div>

          <label className="search-field">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.8" cy="8.8" r="5.8" stroke="currentColor" strokeWidth="1.5" />
              <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              placeholder={t('searchPeople')}
              aria-label={t('searchPeople')}
              value={search}
              dir="auto"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <div className="contact-list" aria-label={t('people')}>
            {isLoadingUsers && <p className="contact-list-state">{t('loadingPeople')}</p>}
            {!isLoadingUsers && errorMessage && !selectedUser && (
              <div className="contact-list-state">
                <p>{errorMessage}</p>
                <button
                  type="button"
                  onClick={() => {
                    setIsLoadingUsers(true);
                    setErrorMessage('');
                    void loadUsers();
                  }}
                >
                  {t('tryAgain')}
                </button>
              </div>
            )}
            {!isLoadingUsers && !errorMessage && filteredUsers.length === 0 && (
              <div className="contact-list-state">
                <strong>{search ? t('noResults') : t('noOtherUsers')}</strong>
                <p>{search ? t('tryAnotherName') : t('newUsersAppear')}</p>
              </div>
            )}
            {filteredUsers.map((user) => {
              const unreadCount = unreadByUser[user.id] || 0;
              return (
                <button
                  type="button"
                  className={`contact-item ${selectedUser?.id === user.id ? 'is-selected' : ''}`}
                  key={user.id}
                  onClick={() => void openConversation(user)}
                  aria-current={selectedUser?.id === user.id ? 'true' : undefined}
                >
                  <span className="contact-avatar" aria-hidden="true">
                    {user.avatar ? (
                      <Image className="avatar-image" src={user.avatar} alt="" width={44} height={44} unoptimized />
                    ) : (
                      user.username.charAt(0)
                    )}
                    <span className={`presence-dot ${onlineUsers.has(user.id) ? 'is-online' : ''}`} />
                  </span>
                  <span className="contact-details">
                    <strong>{user.username}</strong>
                    <small>
                      {onlineUsers.has(user.id)
                        ? t('onlineNow')
                        : formatLastSeen(user.lastSeen, settings.language, t)}
                    </small>
                  </span>
                  {unreadCount > 0 && <span className="unread-badge">{unreadCount}</span>}
                </button>
              );
            })}
          </div>

          <div className="notification-note">
            <span aria-hidden="true"></span>
            {t('notificationNote')}
          </div>
        </aside>

        {selectedUser ? (
          <section className="conversation-panel" aria-label={t('conversationWith', { name: selectedUser.username })}>
            <header className="conversation-header">
              <Button
                className="mobile-back-button"
                variant="ghost"
                size="icon"
                type="button"
                aria-label={t('backToMessages')}
                onClick={() => {
                  selectedUserRef.current = null;
                  setSelectedUser(null);
                  setIsOtherUserTyping(false);
                }}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
              <span className="contact-avatar conversation-avatar" aria-hidden="true">
                {selectedUser.avatar ? (
                  <Image className="avatar-image" src={selectedUser.avatar} alt="" width={42} height={42} unoptimized />
                ) : (
                  selectedUser.username.charAt(0)
                )}
                <span className={`presence-dot ${onlineUsers.has(selectedUser.id) ? 'is-online' : ''}`} />
              </span>
              <div className="conversation-header-info">
                <strong>{selectedUser.username}</strong>
                <span>
                  {isOtherUserTyping
                    ? t('typing')
                    : onlineUsers.has(selectedUser.id)
                      ? t('onlineNow')
                      : formatLastSeen(
                          users.find((user) => user.id === selectedUser.id)?.lastSeen ?? null,
                          settings.language,
                          t,
                        )}
                </span>
              </div>
              <span className="conversation-encryption-note">{t('directMessage')}</span>
              <button
                className="delete-conversation-button"
                type="button"
                aria-label={`${t('deleteConversation')}: ${selectedUser.username}`}
                title={t('deleteConversation')}
                disabled={isDeletingConversation}
                onClick={() => {
                  setDeleteScope(null);
                  setMessageToDelete(null);
                  setErrorMessage('');
                  setIsDeleteDialogOpen(true);
                }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </header>

            {errorMessage && (
              <p className="conversation-error" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="message-list" ref={messageListRef} aria-live="polite">
              {selectedMessages.length === 0 ? (
                <div className="conversation-first-message">
                  <span className="empty-chat-icon" aria-hidden="true">
                    <svg viewBox="0 0 40 40" fill="none">
                      <path
                        d="M9 10h22a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H18l-8 5v-5H9a3 3 0 0 1-3-3V13a3 3 0 0 1 3-3Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M14 19h.01M20 19h.01M26 19h.01"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <strong>{t('startConversationWith', { name: selectedUser.username })}</strong>
                  <span>{t('sendMessageBelow')}</span>
                </div>
              ) : (
                selectedMessages.map((message, index) => {
                  const isOwnMessage = message.sender === userId;
                  const replySenderName = message.replyTo
                    ? message.replyTo.sender === userId
                      ? username || t('yourself')
                      : users.find((user) => user.id === message.replyTo?.sender)?.username || t('messages')
                    : undefined;
                  return (
                    <MessageItem
                      key={message.id || `${message.sender}-${message.createdAt}-${index}`}
                      message={message}
                      isOwnMessage={isOwnMessage}
                      currentUserId={userId || ''}
                      replySenderName={replySenderName}
                      formatTime={(value) => formatMessageTime(value, settings.language)}
                      onReply={replyToChatMessage}
                      onReact={reactToMessage}
                      onForward={setForwardingMessage}
                      onEdit={startEditingMessage}
                      onDelete={openMessageDeleteDialog}
                    />
                  );
                })
              )}
              {isOtherUserTyping && (
                <div
                  className="typing-indicator"
                  role="status"
                  aria-label={`${selectedUser.username} ${t('typing')}`}
                >
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>

            <form className="message-composer" onSubmit={handleSendMessage}>
              {editingMessageId && (
                <div className="editing-banner">
                  <span>{t('editingMessage')}</span>
                  <button type="button" onClick={cancelEditingMessage}>{t('cancel')}</button>
                </div>
              )}
              {replyToMessage && !editingMessageId && (
                <div className="replying-banner">
                  <div>
                    <strong>
                      {t('replyingTo', {
                        name:
                          replyToMessage.sender === userId
                            ? t('yourself')
                            : users.find((user) => user.id === replyToMessage.sender)?.username || t('messages'),
                      })}
                    </strong>
                    <span>{replyToMessage.text}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={t('cancelReply')}
                    onClick={() => setReplyToMessage(null)}
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="message-composer-controls">
                <input
                  ref={messageInputRef}
                  type="text"
                  value={draft}
                  dir="auto"
                  onChange={(event) => handleDraftChange(event.target.value)}
                  placeholder={t('writeMessage')}
                  aria-label={t('writeMessage')}
                  maxLength={2000}
                  disabled={!isConnected || isSending}
                />
                <div className="emoji-picker-container">
                  <button
                    className="emoji-toggle"
                    type="button"
                    aria-label={t('chooseEmoji')}
                    aria-expanded={isEmojiPickerOpen}
                    title={t('chooseEmoji')}
                    disabled={!isConnected || isSending}
                    onClick={() => setIsEmojiPickerOpen((open) => !open)}
                  >
                    <Smile aria-hidden="true" />
                  </button>
                  {isEmojiPickerOpen && (
                    <div className="emoji-picker">
                      <EmojiPicker
                        onEmojiClick={handleEmojiClick}
                        width="min(320px, calc(100vw - 32px))"
                        height={360}
                        lazyLoadEmojis
                        previewConfig={{ showPreview: false }}
                      />
                    </div>
                  )}
                </div>
                <button
                  className="send-message-button"
                  type="submit"
                  disabled={!draft.trim() || !isConnected || isSending}
                  aria-label={editingMessageId ? t('saveEditedMessage') : t('sendMessageAction')}
                  title={editingMessageId ? t('saveChanges') : t('sendMessageAction')}
                >
                  {isSending ? (
                    <span className="button-spinner" aria-hidden="true" />
                  ) : editingMessageId ? (
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <Send aria-hidden="true" />
                  )}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <section className="conversation-welcome" aria-label={t('workspaceWelcome')}>
            <div className="welcome-decoration welcome-decoration-one" aria-hidden="true" />
            <div className="welcome-decoration welcome-decoration-two" aria-hidden="true" />
            <div className="welcome-content">
              <span className="welcome-icon" aria-hidden="true">
                <svg viewBox="0 0 56 56" fill="none">
                  <path
                    d="M13 16h30a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H26l-9 6v-6h-4a4 4 0 0 1-4-4V20a4 4 0 0 1 4-4Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M20 28h.01M28 28h.01M36 28h.01"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="eyebrow">{t('welcomeToWisal')}</span>
              <h2>
                {t('helloUser', { name: username })}
                <span className="wave-emoji" aria-hidden="true"> 👋</span>
              </h2>
              <p>
                {t('chooseSomeone')}
                <br />
                {t('notifyNewMessage')}
              </p>
              <span className="welcome-status">
                <span className={`status-dot ${isConnected ? '' : 'is-offline'}`} />
                {isConnected ? t('readyToChat') : t('connectingServer')}
              </span>
            </div>
            <div className="workspace-bottom-note">{t('everyConversationStarts')}</div>
          </section>
        )}
      </section>
    </main>
  );
}

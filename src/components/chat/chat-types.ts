export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface ChatReaction {
  emoji: string;
  users: string[];
}

export interface MessageReply {
  messageId: string;
  sender: string;
  text: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  receiver: string;
  text: string;
  createdAt: string;
  status?: MessageStatus;
  edited?: boolean;
  editedAt?: string;
  forwarded?: boolean;
  forwardedFrom?: string;
  replyTo?: MessageReply;
  reactions?: ChatReaction[];
}

export interface ChatUser {
  id: string;
  username: string;
  avatar: string | null;
  lastSeen: string | null;
  isOnline: boolean;
}

const express = require('express');
const http = require('http');
const { createHash, randomBytes } = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const User = require('./models/User');
const Message = require('./models/Message');
const AuthToken = require('./models/AuthToken');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const googleOAuthClient = new OAuth2Client();

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '100kb' }));
app.get('/healthz', (req, res) => {
  const isDatabaseConnected = mongoose.connection.readyState === 1;
  res.status(isDatabaseConnected ? 200 : 503).json({
    status: isDatabaseConnected ? 'ok' : 'unavailable',
  });
});

const USERNAME_COOLDOWN_MS = 20 * 24 * 60 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;
const PASSWORD_RESET_RATE_LIMIT_MS = 60 * 1000;

function createEmailTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !Number.isInteger(port) || port <= 0) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function createOneTimeToken(purpose, userId, expiresInMs) {
  const token = randomBytes(32).toString('hex');
  await AuthToken.create({
    _id: hashToken(token),
    userId,
    purpose,
    expiresAt: new Date(Date.now() + expiresInMs),
  });
  return token;
}

function validateNewPassword(password) {
  return password.length >= 8 && Buffer.byteLength(password, 'utf8') <= 72;
}

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
}

async function sendAccountEmail({ to, subject, text, html }) {
  const transporter = createEmailTransporter();
  if (!transporter) {
    throw new Error('Email service is not configured');
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}

async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await AuthToken.create({ _id: hashToken(token), userId, purpose: 'session' });
  return token;
}

async function requireSession(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const session = token
    ? await AuthToken.findOne({ _id: hashToken(token), purpose: 'session' })
    : null;
  const user = session ? await User.findById(session.userId) : null;

  if (!user) {
    return res.status(401).json({ error: 'Please sign in again to continue' });
  }

  req.user = user;
  next();
}

function getNextUsernameChangeAt(user) {
  return user.usernameChangedAt
    ? new Date(new Date(user.usernameChangedAt).getTime() + USERNAME_COOLDOWN_MS).toISOString()
    : null;
}

function getSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar || null,
    isOnline: onlineUsers.has(user.id),
    lastSeen: lastSeenUsers.get(user.id) || null,
  };
}

// ------------------------------------
// 1. HTTP APIs (Auth & Users)
// ------------------------------------

// Register accounts only after the email address has been verified.
app.post('/api/register', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const { password } = req.body || {};

  if (!username || !email || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }
  if (username.length > 40) {
    return res.status(400).json({ error: 'Username must be 40 characters or fewer' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (!validateNewPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 bytes' });
  }
  if (!createEmailTransporter()) {
    return res.status(503).json({ error: 'Email service is not configured' });
  }

  await User.deleteMany({
    emailVerified: false,
    emailVerificationExpiresAt: { $lte: Date.now() },
  });

  // نتأكد إن الاسم مش مسجل قبل كده
  const usernameNormalized = username.toLocaleLowerCase();
  const existingUser = await User.findOne({ usernameNormalized });
  if (existingUser) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  if (await User.exists({ email })) {
    return res.status(409).json({ error: 'Email address is already registered' });
  }

  const newUser = new User({
    _id: randomBytes(16).toString('hex'),
    username,
    usernameNormalized,
    email,
    emailVerified: false,
    emailVerificationExpiresAt: Date.now() + EMAIL_VERIFICATION_TTL_MS,
    password: await bcrypt.hash(password, 12),
    avatar: null,
    usernameChangedAt: null,
  });

  try {
    await newUser.save();
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        error: error.keyPattern?.email
          ? 'Email address is already registered'
          : 'Username already taken',
      });
    }
    throw error;
  }
  const token = await createOneTimeToken('email-verification', newUser.id, EMAIL_VERIFICATION_TTL_MS);
  const verificationUrl = `${getFrontendUrl()}/verify-email?token=${encodeURIComponent(token)}`;

  try {
    await sendAccountEmail({
      to: email,
      subject: 'Verify your Wisal email address',
      text: `Hello ${username},\n\nVerify your email address to activate your Wisal account:\n${verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, you can ignore this email.`,
      html: `<p>Hello ${escapeHtml(username)},</p><p>Verify your email address to activate your Wisal account:</p><p><a href="${verificationUrl}">Verify email address</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p>`,
    });
  } catch (error) {
    await User.findByIdAndDelete(newUser.id);
    await AuthToken.deleteOne({ _id: hashToken(token), purpose: 'email-verification' });
    console.error(
      'Could not send account verification email:',
      error instanceof Error ? error.message : 'Unknown email delivery error',
    );
    return res.status(503).json({ error: 'Could not send email. Check the email service configuration and try again.' });
  }

  res.status(201).json({ message: 'Check your email to verify your account.' });
});

// تسجيل الدخول
app.post('/api/login', async (req, res) => {
  const { password } = req.body || {};
  const identifier = [req.body?.identifier, req.body?.email, req.body?.username]
    .find((value) => typeof value === 'string')?.trim().toLocaleLowerCase() || '';

  const user = await User.findOne({
    $or: [
      { usernameNormalized: identifier },
      { email: identifier },
    ],
  });
  const hasHashedPassword = typeof user?.password === 'string' && /^\$2[aby]\$/.test(user.password);
  const passwordMatches = user && typeof password === 'string'
    ? hasHashedPassword
      ? await bcrypt.compare(password, user.password)
      : user.password === password
    : false;
  if (!passwordMatches || !user) {
    return res.status(401).json({ error: 'Invalid email, username, or password' });
  }
  if (!user.emailVerified) {
    return res.status(403).json({ error: 'Verify your email address before signing in' });
  }
  if (!hasHashedPassword) {
    user.password = await bcrypt.hash(password, 12);
    await user.save();
  }

  res.json({
    userId: user.id,
    username: user.username,
    avatar: user.avatar || null,
    token: await createSession(user.id),
  });
});

app.post('/api/auth/google', async (req, res) => {
  const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'Google sign-in is not configured' });
  }
  if (!credential) {
    return res.status(400).json({ error: 'A Google credential is required' });
  }

  let payload;
  try {
    const ticket = await googleOAuthClient.verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'Could not verify Google sign-in' });
  }

  const email = payload?.email?.trim().toLowerCase();
  if (!payload?.sub || !email || payload.email_verified !== true) {
    return res.status(401).json({ error: 'Google must verify the account email address' });
  }

  const googleUser = await User.findOne({ googleSub: payload.sub });
  const emailUser = await User.findOne({ email });
  if (googleUser && emailUser && googleUser.id !== emailUser.id) {
    return res.status(409).json({ error: 'This email is linked to a different Google account' });
  }

  let user = googleUser || emailUser;
  if (user) {
    if (user.googleSub && user.googleSub !== payload.sub) {
      return res.status(409).json({ error: 'This email is linked to a different Google account' });
    }
    user.email = email;
    user.googleSub = payload.sub;
    user.emailVerified = true;
    user.emailVerificationExpiresAt = undefined;
    if (!user.avatar && payload.picture) {
      user.avatar = payload.picture;
    }
    await user.save();
    await AuthToken.deleteMany({ userId: user.id, purpose: 'email-verification' });
  } else {
    const baseUsername = (payload.name || email.split('@')[0]).trim().slice(0, 40) || 'Google user';
    let username = baseUsername;
    let usernameNormalized = username.toLocaleLowerCase();
    while (await User.exists({ usernameNormalized })) {
      const suffix = randomBytes(3).toString('hex');
      username = `${baseUsername.slice(0, 33)}-${suffix}`;
      usernameNormalized = username.toLocaleLowerCase();
    }

    user = await User.create({
      _id: randomBytes(16).toString('hex'),
      username,
      usernameNormalized,
      email,
      emailVerified: true,
      googleSub: payload.sub,
      avatar: payload.picture || null,
    });
  }

  res.json({
    userId: user.id,
    username: user.username,
    avatar: user.avatar || null,
    token: await createSession(user.id),
  });
});

app.post('/api/verify-email', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const tokenHash = hashToken(token);
  const record = await AuthToken.findOneAndDelete({
    _id: tokenHash,
    purpose: 'email-verification',
    expiresAt: { $gt: new Date() },
  });
  if (!record) {
    await AuthToken.deleteOne({ _id: tokenHash, purpose: 'email-verification' });
    return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
  }

  const user = await User.findById(record.userId);
  if (!user) {
    return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
  }

  user.emailVerified = true;
  user.emailVerificationExpiresAt = undefined;
  await user.save();
  res.json({ message: 'Email verified. You can now sign in.' });
});

app.post('/api/password-reset/request', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (!createEmailTransporter()) {
    return res.status(503).json({ error: 'Email service is not configured' });
  }

  const rateLimitId = `rate:${hashToken(email)}`;
  const activeRateLimit = await AuthToken.findOne({
    _id: rateLimitId,
    purpose: 'password-reset-rate-limit',
    expiresAt: { $gt: new Date() },
  });
  if (activeRateLimit) {
    return res.json({ message: 'If a verified account uses that email, a reset link will be sent.' });
  }
  await AuthToken.findOneAndUpdate(
    { _id: rateLimitId },
    {
      $set: {
        purpose: 'password-reset-rate-limit',
        expiresAt: new Date(Date.now() + PASSWORD_RESET_RATE_LIMIT_MS),
      },
      $unset: { userId: 1 },
    },
    { upsert: true },
  );

  const user = await User.findOne({ email, emailVerified: true });
  if (!user) {
    return res.json({ message: 'If a verified account uses that email, a reset link will be sent.' });
  }

  const token = await createOneTimeToken('password-reset', user.id, PASSWORD_RESET_TTL_MS);
  const resetUrl = `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  try {
    await sendAccountEmail({
      to: email,
      subject: 'Reset your Wisal password',
      text: `Hello ${user.username},\n\nUse this link to choose a new Wisal password:\n${resetUrl}\n\nThis link expires in 15 minutes and can only be used once. If you did not request a password reset, you can ignore this email.`,
      html: `<p>Hello ${escapeHtml(user.username)},</p><p>Use this link to choose a new Wisal password:</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 15 minutes and can only be used once. If you did not request a password reset, you can ignore this email.</p>`,
    });
  } catch (error) {
    await AuthToken.deleteOne({ _id: hashToken(token), purpose: 'password-reset' });
    console.error(
      'Could not send password reset email:',
      error instanceof Error ? error.message : 'Unknown email delivery error',
    );
  }

  res.json({ message: 'If a verified account uses that email, a reset link will be sent.' });
});

app.post('/api/password-reset/confirm', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!validateNewPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and no more than 72 bytes' });
  }

  const tokenHash = hashToken(token);
  const record = await AuthToken.findOneAndDelete({
    _id: tokenHash,
    purpose: 'password-reset',
    expiresAt: { $gt: new Date() },
  });
  if (!record) {
    await AuthToken.deleteOne({ _id: tokenHash, purpose: 'password-reset' });
    return res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
  }

  const user = await User.findOne({ _id: record.userId, emailVerified: true });
  if (!user) {
    return res.status(400).json({ error: 'This password reset link is invalid or has expired.' });
  }

  user.password = await bcrypt.hash(password, 12);
  await user.save();
  await AuthToken.deleteMany({ userId: user.id, purpose: 'session' });
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.userId === user.id) {
      socket.disconnect(true);
    }
  }
  res.json({ message: 'Password updated. You can now sign in.' });
});

app.get('/api/profile', requireSession, (req, res) => {
  res.json({
    ...getSafeUser(req.user),
    usernameChangedAt: req.user.usernameChangedAt || null,
    nextUsernameChangeAt: getNextUsernameChangeAt(req.user),
  });
});

app.patch('/api/profile', requireSession, async (req, res) => {
  const { username, avatar } = req.body || {};
  const hasUsername = Object.hasOwn(req.body || {}, 'username');
  const hasAvatar = Object.hasOwn(req.body || {}, 'avatar');

  if (!hasUsername && !hasAvatar) {
    return res.status(400).json({ error: 'There are no profile changes to save' });
  }

  let nextUsername = req.user.username;
  if (hasUsername) {
    if (typeof username !== 'string' || !username.trim() || username.trim().length > 40) {
      return res.status(400).json({ error: 'Username must be between 1 and 40 characters' });
    }

    nextUsername = username.trim();
    const isNameChanging = nextUsername !== req.user.username;
    if (isNameChanging) {
      const nextAllowedAt = getNextUsernameChangeAt(req.user);
      if (nextAllowedAt && Date.now() < new Date(nextAllowedAt).getTime()) {
        return res.status(429).json({
          error: 'You can change your username again after the 20-day cooldown.',
          nextUsernameChangeAt: nextAllowedAt,
        });
      }

      const nameIsTaken = await User.exists({
        _id: { $ne: req.user.id },
        usernameNormalized: nextUsername.toLocaleLowerCase(),
      });
      if (nameIsTaken) {
        return res.status(409).json({ error: 'Username already taken' });
      }
    }
  }

  if (hasAvatar && avatar !== null) {
    const isValidAvatar =
      typeof avatar === 'string' &&
      avatar.length <= 80_000 &&
      /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar);
    if (!isValidAvatar) {
      return res.status(400).json({ error: 'Choose a valid image under 80 KB' });
    }
  }

  if (hasUsername && nextUsername !== req.user.username) {
    req.user.username = nextUsername;
    req.user.usernameNormalized = nextUsername.toLocaleLowerCase();
    req.user.usernameChangedAt = new Date().toISOString();
  }
  if (hasAvatar) {
    req.user.avatar = avatar;
  }
  try {
    await req.user.save();
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    throw error;
  }

  const profile = {
    ...getSafeUser(req.user),
    usernameChangedAt: req.user.usernameChangedAt,
    nextUsernameChangeAt: getNextUsernameChangeAt(req.user),
  };
  io.emit('profile_updated', {
    userId: req.user.id,
    username: profile.username,
    avatar: profile.avatar,
  });
  res.json(profile);
});

// جلب قائمة كل المستخدمين
app.get('/api/users', async (req, res) => {
  // بنرجع المستخدمين بدون كلمة المرور حفاظاً على الأمان
  const users = await User.find({ emailVerified: true }).select('-password').sort({ username: 1 });
  const safeUsers = users.map(getSafeUser);
  res.json(safeUsers);
});

// جلب الرسائل السابقة بين مستخدمين
app.get('/api/messages/:senderId/:receiverId', async (req, res) => {
  const { senderId, receiverId } = req.params;
  const chatMessages = await Message.find({
    deletedFor: { $ne: senderId },
    $or: [
      { sender: senderId, receiver: receiverId },
      { sender: receiverId, receiver: senderId },
    ],
  }).sort({ createdAt: 1 });

  res.json(chatMessages);
});

// ------------------------------------
// 2. Socket.io Real-Time Engine
// ------------------------------------

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
  }
});

const onlineUsers = new Map(); // userId -> socketId
const lastSeenUsers = new Map();

function onSocket(socket, event, handler) {
  socket.on(event, (...args) => {
    Promise.resolve(handler(...args)).catch((error) => {
      console.error(`Socket handler "${event}" failed:`, error);
      socket.emit('chat_error', { error: 'Could not complete the request. Please try again.' });
    });
  });
}

async function updateMessageStatus(message, status) {
  const statusOrder = { sent: 0, delivered: 1, read: 2 };
  if (statusOrder[status] <= statusOrder[message.status || 'sent']) {
    return;
  }

  message.status = status;
  if (status === 'delivered') {
    message.deliveredAt = new Date().toISOString();
  } else if (status === 'read') {
    message.readAt = new Date().toISOString();
  }
  await message.save();

  const senderSocketId = onlineUsers.get(message.sender);
  if (senderSocketId) {
    io.to(senderSocketId).emit('message_status', { messageId: message.id, status });
  }
}

// Hide a conversation for one user or permanently remove it for both users.
app.delete('/api/messages/:userId/:otherUserId', async (req, res) => {
  const { userId, otherUserId } = req.params;
  const { scope } = req.body;

  const authorization = req.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const session = token
    ? await AuthToken.findOne({ _id: hashToken(token), purpose: 'session' })
    : null;
  if (!session || session.userId !== userId) {
    return res.status(401).json({ error: 'Please log in again before deleting a conversation' });
  }

  if (!userId || !otherUserId || userId === otherUserId) {
    return res.status(400).json({ error: 'Two different users are required' });
  }

  if (scope !== 'me' && scope !== 'both') {
    return res.status(400).json({ error: 'Scope must be "me" or "both"' });
  }

  const conversation = {
    $or: [
      { sender: userId, receiver: otherUserId },
      { sender: otherUserId, receiver: userId },
    ],
  };
  if (scope === 'both') {
    const { deletedCount } = await Message.deleteMany(conversation);
    [userId, otherUserId].forEach((participantId) => {
      const socketId = onlineUsers.get(participantId);
      if (socketId) {
        io.to(socketId).emit('conversation_deleted', {
          userId,
          otherUserId,
          scope,
          deletedBy: userId,
        });
      }
    });

    return res.json({ scope, deletedCount });
  }

  const result = await Message.updateMany(
    { ...conversation, deletedFor: { $ne: userId } },
    { $addToSet: { deletedFor: userId } },
  );
  const deletedCount = result.modifiedCount;

  const otherSocketId = onlineUsers.get(otherUserId);
  if (otherSocketId) {
    io.to(otherSocketId).emit('conversation_deleted', {
      userId,
      otherUserId,
      scope,
      deletedBy: userId,
    });
  }

  return res.json({ scope, deletedCount });
});

app.delete('/api/messages/:userId/:otherUserId/:messageId', async (req, res) => {
  const { userId, otherUserId, messageId } = req.params;
  const { scope } = req.body;

  const authorization = req.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const session = token
    ? await AuthToken.findOne({ _id: hashToken(token), purpose: 'session' })
    : null;
  if (!session || session.userId !== userId) {
    return res.status(401).json({ error: 'Please log in again before deleting a message' });
  }

  if (!userId || !otherUserId || userId === otherUserId || !messageId) {
    return res.status(400).json({ error: 'A valid conversation and message are required' });
  }

  if (scope !== 'me' && scope !== 'both') {
    return res.status(400).json({ error: 'Scope must be "me" or "both"' });
  }

  const message = await Message.findOne({
    _id: messageId,
    $or: [
      { sender: userId, receiver: otherUserId },
      { sender: otherUserId, receiver: userId },
    ],
  });
  if (!message) {
    return res.status(404).json({ error: 'Message not found in this conversation' });
  }

  if (scope === 'both' && message.sender !== userId) {
    return res.status(403).json({ error: 'You can only delete your own message for everyone' });
  }

  if (scope === 'both') {
    await message.deleteOne();
  } else {
    message.deletedFor.addToSet(userId);
    await message.save();
  }

  const event = { messageId, userId, otherUserId, deletedBy: userId, scope };
  const participants = scope === 'both' ? [userId, otherUserId] : [userId];
  participants.forEach((participantId) => {
    const socketId = onlineUsers.get(participantId);
    if (socketId) {
      io.to(socketId).emit('message_deleted', event);
    }
  });

  return res.json({ scope, messageId });
});

io.on('connection', (socket) => {
  console.log('⚡ User connected:', socket.id);

  // تسجيل المستخدم المتصل حالياً
  onSocket(socket, 'register_user', async (userId) => {
    if (typeof userId !== 'string' || !await User.exists({ _id: userId, emailVerified: true })) {
      return;
    }

    socket.data.userId = userId;
    onlineUsers.set(userId, socket.id);
    lastSeenUsers.delete(userId);
    const undeliveredMessages = await Message.find({ receiver: userId, status: 'sent' });
    await Promise.all(undeliveredMessages.map((message) => updateMessageStatus(message, 'delivered')));
    io.emit('online_users', Array.from(onlineUsers.keys()));
    io.emit('user_status', { userId, isOnline: true, lastSeen: null });
  });

  // استقبال وإرسال رسالة جديدة
  onSocket(socket, 'send_message', async (data) => {
    const { senderId, receiverId, text, replyToMessageId } = data || {};
    if (
      senderId !== socket.data.userId ||
      typeof text !== 'string' ||
      !text.trim() ||
      !await User.exists({ _id: receiverId, emailVerified: true }) ||
      receiverId === senderId
    ) {
      return;
    }

    let replyTo;
    if (replyToMessageId) {
      const repliedMessage = await Message.findOne({
        _id: replyToMessageId,
        deletedFor: { $ne: senderId },
        $or: [
          { sender: senderId, receiver: receiverId },
          { sender: receiverId, receiver: senderId },
        ],
      });
      if (!repliedMessage) {
        socket.emit('chat_error', { error: 'The message you are replying to is no longer available.' });
        return;
      }

      replyTo = {
        messageId: repliedMessage.id,
        sender: repliedMessage.sender,
        text: repliedMessage.text,
      };
    }

    const newMessage = new Message({
      _id: randomBytes(16).toString('hex'),
      sender: senderId,
      receiver: receiverId,
      text: text.trim(),
      createdAt: new Date().toISOString(),
      status: 'sent',
      edited: false,
      ...(replyTo ? { replyTo } : {}),
    });

    await newMessage.save();
    const messageResponse = newMessage.toJSON();

    // إرسال الرسالة للطرف التاني لو متصل
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receive_message', messageResponse);
    }

    // تأكيد وصول الرسالة للراسل نفسه
    socket.emit('message_sent', messageResponse);
  });

  onSocket(socket, 'toggle_reaction', async ({ userId, messageId, emoji } = {}) => {
    if (
      userId !== socket.data.userId ||
      typeof messageId !== 'string' ||
      typeof emoji !== 'string' ||
      !emoji.trim() ||
      Array.from(emoji).length > 16
    ) {
      return;
    }

    const message = await Message.findOne({
      _id: messageId,
      deletedFor: { $ne: userId },
      $or: [{ sender: userId }, { receiver: userId }],
    });
    if (!message) {
      socket.emit('chat_error', { error: 'This message is no longer available for a reaction.' });
      return;
    }

    message.reactions = message.reactions || [];
    const existingReaction = message.reactions.find((reaction) => reaction.emoji === emoji);
    if (existingReaction?.users.includes(userId)) {
      existingReaction.users = existingReaction.users.filter((id) => id !== userId);
      if (existingReaction.users.length === 0) {
        message.reactions = message.reactions.filter((reaction) => reaction.emoji !== emoji);
      }
    } else if (existingReaction) {
      existingReaction.users.push(userId);
    } else {
      message.reactions.push({ emoji, users: [userId] });
    }
    await message.save();

    const event = { messageId, reactions: message.reactions };
    [message.sender, message.receiver].forEach((participantId) => {
      const participantSocketId = onlineUsers.get(participantId);
      if (participantSocketId) {
        io.to(participantSocketId).emit('message_reactions_updated', event);
      }
    });
  });

  onSocket(socket, 'forward_message', async ({ senderId, receiverId, messageId } = {}) => {
    if (
      senderId !== socket.data.userId ||
      typeof receiverId !== 'string'
    ) {
      return;
    }

    if (receiverId === senderId || !await User.exists({ _id: receiverId, emailVerified: true })) {
      socket.emit('chat_error', { error: 'Choose a valid person to forward this message to.' });
      return;
    }

    const originalMessage = await Message.findOne({
      _id: messageId,
      deletedFor: { $ne: senderId },
      $or: [{ sender: senderId }, { receiver: senderId }],
    });
    if (!originalMessage) {
      socket.emit('chat_error', { error: 'This message is no longer available to forward.' });
      return;
    }

    const originalSender = await User.findById(originalMessage.sender);
    const forwardedMessage = new Message({
      _id: randomBytes(16).toString('hex'),
      sender: senderId,
      receiver: receiverId,
      text: originalMessage.text,
      createdAt: new Date().toISOString(),
      status: 'sent',
      edited: false,
      forwarded: true,
      forwardedFrom: originalMessage.forwardedFrom || originalSender?.username || 'A user',
    });
    await forwardedMessage.save();
    const messageResponse = forwardedMessage.toJSON();

    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receive_message', messageResponse);
    }
    socket.emit('message_sent', messageResponse);
  });

  onSocket(socket, 'message_delivered', async ({ messageId, receiverId }) => {
    if (receiverId !== socket.data.userId || !messageId) {
      return;
    }

    const message = await Message.findOne({ _id: messageId, receiver: receiverId });
    if (message) {
      await updateMessageStatus(message, 'delivered');
    }
  });

  onSocket(socket, 'mark_messages_read', async ({ readerId, senderId }) => {
    if (
      readerId !== socket.data.userId ||
      !senderId ||
      senderId === readerId ||
      !await User.exists({ _id: senderId, emailVerified: true })
    ) {
      return;
    }

    const unreadMessages = await Message.find({
      sender: senderId,
      receiver: readerId,
      status: { $ne: 'read' },
    });
    await Promise.all(unreadMessages.map((message) => updateMessageStatus(message, 'read')));
  });

  onSocket(socket, 'edit_message', async ({ messageId, senderId, text }) => {
    const updatedText = typeof text === 'string' ? text.trim() : '';
    if (senderId !== socket.data.userId || !messageId || !updatedText) {
      return;
    }

    const message = await Message.findOne({ _id: messageId, sender: senderId });
    if (!message) {
      return;
    }

    message.text = updatedText;
    message.edited = true;
    message.editedAt = new Date().toISOString();
    await message.save();

    const messageResponse = message.toJSON();
    [message.sender, message.receiver].forEach((participantId) => {
      const participantSocketId = onlineUsers.get(participantId);
      if (participantSocketId) {
        io.to(participantSocketId).emit('message_edited', messageResponse);
      }
    });
  });

  // مؤشر الكتابة (Typing)
  socket.on('typing', ({ senderId, receiverId }) => {
    if (senderId !== socket.data.userId) {
      return;
    }

    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_typing', { senderId });
    }
  });

  socket.on('stop_typing', ({ senderId, receiverId }) => {
    if (senderId !== socket.data.userId) {
      return;
    }

    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_stopped_typing', { senderId });
    }
  });

  // قطع الاتصال
  socket.on('disconnect', () => {
    const userId = socket.data.userId;
    if (userId && onlineUsers.get(userId) === socket.id) {
      onlineUsers.delete(userId);
      const lastSeen = new Date().toISOString();
      lastSeenUsers.set(userId, lastSeen);
      io.emit('user_status', { userId, isOnline: false, lastSeen });
    }
    io.emit('online_users', Array.from(onlineUsers.keys()));
    console.log('❌ User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required. Add your MongoDB connection string to .env.');
  }

  await mongoose.connect(mongoUri);
  console.log(`Connected to MongoDB database "${mongoose.connection.name}"`);
  server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));
}

startServer().catch((error) => {
  console.error('Could not start the server:', error);
  process.exitCode = 1;
});
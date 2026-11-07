const mongoose = require('mongoose');

const authTokenSchema = new mongoose.Schema({
  _id: { type: String },
  userId: { type: String },
  purpose: {
    type: String,
    enum: ['session', 'email-verification', 'password-reset', 'password-reset-rate-limit'],
    required: true,
    index: true,
  },
  expiresAt: { type: Date, expires: 0 },
}, { versionKey: false });

module.exports = mongoose.model('AuthToken', authTokenSchema);

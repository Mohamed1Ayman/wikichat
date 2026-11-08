const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _id: { type: String },
  username: { type: String, required: true },
  usernameNormalized: { type: String, required: true, unique: true },
  email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
  emailVerified: { type: Boolean, default: false },
  emailVerificationExpiresAt: Number,
  password: { type: String },
  googleSub: { type: String, unique: true, sparse: true },
  avatar: { type: String, default: null },
  usernameChangedAt: { type: String, default: null },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('User', userSchema);

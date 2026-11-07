const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  _id: { type: String },
  sender: { type: String, required: true, index: true },
  receiver: { type: String, required: true, index: true },
  text: { type: String, required: true },
  createdAt: { type: String, required: true },
  status: { type: String, default: 'sent' },
  edited: { type: Boolean, default: false },
  editedAt: String,
  deliveredAt: String,
  readAt: String,
  deletedFor: [String],
  reactions: [{
    emoji: String,
    users: [String],
  }],
  replyTo: {
    messageId: String,
    sender: String,
    text: String,
  },
  forwarded: Boolean,
  forwardedFrom: String,
}, {
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

messageSchema.virtual('id').get(function getId() {
  return this._id;
});

module.exports = mongoose.model('Message', messageSchema);

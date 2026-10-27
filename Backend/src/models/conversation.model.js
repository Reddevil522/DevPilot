const mongoose = require('mongoose');

const changeSchema = new mongoose.Schema({
  path: {
    type: String,
    required: true,
    trim: true,
  },
  operation: {
    type: String,
    enum: ['create', 'edit'],
    required: true,
  },
  content: {
    type: String,
    default: '',
  },
  originalContent: {
    type: String,
    default: '',
  },
  originalHash: {
    type: String,
    default: '',
  },
  explanation: {
    type: String,
    default: '',
  },
}, { _id: false });

const proposalSchema = new mongoose.Schema({
  summary: {
    type: String,
    default: '',
    trim: true,
  },
  status: {
    type: String,
    enum: ['pending', 'applied', 'rejected'],
    default: 'pending',
  },
  changes: [changeSchema],
}, { _id: false });

const messageSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  proposal: {
    type: proposalSchema,
    default: null,
  },
}, { _id: false });

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
      index: true,
    },
    title: {
      type: String,
      default: 'New Chat',
      trim: true,
      maxlength: 150,
    },
    messages: [messageSchema],
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

conversationSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

module.exports = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);

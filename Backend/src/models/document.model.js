const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: [true, 'Project ID is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Document title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    docType: {
      type: String,
      required: [true, 'Document type is required'],
      enum: {
        values: [
          'readme',
          'api',
          'code',
          'architecture',
          'deployment',
          'proposal',
          'report',
          'meeting_notes',
          'study_notes',
          'business',
          'custom'
        ],
        message: '{VALUE} is not a supported document type',
      },
      default: 'readme',
    },
    filePath: {
      type: String,
      trim: true,
      maxlength: [500, 'File path cannot exceed 500 characters'],
      default: '',
    },
    content: {
      type: String,
      default: '',
    },
    format: {
      type: String,
      enum: ['markdown', 'text', 'html'],
      default: 'markdown',
    },
    status: {
      type: String,
      enum: ['draft', 'generating', 'completed', 'failed', 'archived'],
      default: 'completed',
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    metadata: {
      model: { type: String, default: '' },
      instructions: { type: String, default: '' },
      sourceContent: { type: String, default: '' },
      generationTimeMs: { type: Number, default: 0 },
      wordCount: { type: Number, default: 0 },
      proposal: { type: mongoose.Schema.Types.Mixed, default: null },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for efficient user and project document queries
documentSchema.index({ projectId: 1, userId: 1, updatedAt: -1 });

documentSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

module.exports = mongoose.models.Document || mongoose.model('Document', documentSchema);


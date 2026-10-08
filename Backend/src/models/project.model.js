const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: [100, 'Project name cannot be more than 100 characters'],
    },
    slug: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      maxlength: [200, 'Description cannot be more than 200 characters'],
      default: '',
    },
    technology: {
      type: String,
      required: [true, 'Technology is required'],
      enum: ['angular', 'react', 'nodejs', 'express', 'fullstack', 'custom'],
    },
    template: {
      type: String,
      required: [true, 'Template is required'],
      enum: ['blank', 'mean', 'mern', 'angular', 'node-api', 'ai-app'],
    },
    projectType: {
      type: String,
      required: [true, 'Project type is required'],
      enum: ['local', 'cloud'],
      default: 'cloud',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    language: {
      type: String,
      default: 'JavaScript',
    },
    localPath: {
      type: String,
    },
    deploymentUrl: {
      type: String,
    },
    gitBranch: {
      type: String,
      default: 'main',
    },
    ownerId: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    syncEnabled: {
      type: Boolean,
      default: false,
    },
    syncStatus: {
      type: String,
      enum: ['LOCAL_ONLY', 'SYNCED', 'LOCAL_CHANGES', 'CLOUD_CHANGES', 'CONFLICT', 'OFFLINE', 'ERROR'],
      default: 'LOCAL_ONLY',
    },
    localWorkspaceId: {
      type: String,
    },
    localProjectIdentifier: {
      type: String,
    },
    fileMetadata: [
      {
        path: String,
        hash: String,
        size: Number,
        version: { type: Number, default: 1 },
        lastSyncedAt: Date,
        lastModifiedAt: Date,
      }
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound unique index for ownerId and slug
projectSchema.index({ ownerId: 1, slug: 1 }, { unique: true });

// Virtual for frontend compatibility
projectSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

module.exports = mongoose.model('Project', projectSchema);

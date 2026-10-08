const AngularTemplate = require('./AngularTemplate');
const ReactTemplate = require('./ReactTemplate');
const NodeApiTemplate = require('./NodeApiTemplate');
const ExpressTemplate = require('./ExpressTemplate');
const MeanTemplate = require('./MeanTemplate');
const MernTemplate = require('./MernTemplate');
const FullStackTemplate = require('./FullStackTemplate');
const AiApplicationTemplate = require('./AiApplicationTemplate');
const BlankTemplate = require('./BlankTemplate');
const CustomTemplate = require('./CustomTemplate');

class TemplateFactory {
  static normalizeTemplate(templateStr) {
    if (!templateStr) return null;
    const normalized = templateStr.toLowerCase().trim();
    if (normalized.includes('mean')) return 'mean';
    if (normalized.includes('mern')) return 'mern';
    if (normalized.includes('angular')) return 'angular';
    if (normalized.includes('react')) return 'react';
    if (normalized.includes('node api') || normalized.includes('node-api')) return 'node-api';
    if (normalized.includes('express')) return 'express';
    if (normalized.includes('full stack') || normalized.includes('full-stack')) return 'full-stack';
    if (normalized.includes('ai application') || normalized.includes('ai-application')) return 'ai-application';
    if (normalized.includes('blank')) return 'blank';
    if (normalized.includes('custom')) return 'custom';
    return normalized;
  }

  static getTemplate(projectPath, projectName, description, projectId, technology, template, projectType, emitProgress) {
    const args = [projectPath, projectName, description, projectId, technology, projectType, emitProgress];

    const normalizedTemplate = this.normalizeTemplate(template);

    switch (normalizedTemplate) {
      case 'angular':
        return new AngularTemplate(...args);
      case 'react':
        return new ReactTemplate(...args);
      case 'node-api':
        return new NodeApiTemplate(...args);
      case 'express':
        return new ExpressTemplate(...args);
      case 'mean':
        return new MeanTemplate(...args);
      case 'mern':
        return new MernTemplate(...args);
      case 'full-stack':
        return new FullStackTemplate(...args);
      case 'ai-application':
        return new AiApplicationTemplate(...args);
      case 'blank':
        return new BlankTemplate(...args);
      case 'custom':
        return new CustomTemplate(...args);
      default:
        throw new Error(`Unsupported project template: ${template}`);
    }
  }
}

module.exports = TemplateFactory;

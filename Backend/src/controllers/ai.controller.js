const crypto = require('crypto');
const Conversation = require('../models/conversation.model');
const Project = require('../models/project.model');
const AiService = require('../services/ai.service');
const AiContextService = require('../services/ai-context.service');
const AiFileApplyService = require('../services/ai-file-apply.service');

// @desc    Send a message to AI Chat with project awareness
// @route   POST /api/ai/chat
// @access  Private
exports.chat = async (req, res, next) => {
  try {
    const { message, projectId, conversationId, activeFilePath, selectedCode, errorContext } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required.' });
    }

    if (message.length > 20000) {
      return res.status(400).json({ success: false, message: 'Message exceeds maximum allowed length (20,000 characters).' });
    }

    const userId = req.user.id || req.user._id?.toString();

    // 1. Resolve Project (if provided)
    let project = null;
    if (projectId) {
      project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found.' });
      }
      if (project.ownerId.toString() !== userId) {
        return res.status(403).json({ success: false, message: 'You do not have access to this project.' });
      }
    }

    // 2. Resolve Conversation
    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (conversation && conversation.userId.toString() !== userId) {
        return res.status(403).json({ success: false, message: 'You do not own this conversation.' });
      }
    }

    if (!conversation) {
      conversation = new Conversation({
        userId,
        projectId: project ? project._id : null,
        title: message.trim().slice(0, 50) + (message.length > 50 ? '...' : ''),
        messages: []
      });
    }

    // 3. Gather project-aware context
    let projectContext = '';
    if (project) {
      projectContext = await AiContextService.buildContext({
        project,
        activeFilePath,
        selectedCode,
        userPrompt: message,
        errorContext
      });
    }

    // 4. Generate AI response from provider
    const { content, proposal } = await AiService.generateResponse({
      userMessage: message,
      history: conversation.messages,
      projectContext,
      project
    });

    // 5. Append messages to conversation history
    const userMsgObj = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    const assistantMsgObj = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: new Date(),
      proposal: proposal || null
    };

    conversation.messages.push(userMsgObj);
    conversation.messages.push(assistantMsgObj);
    conversation.lastActive = new Date();

    await conversation.save();

    res.status(200).json({
      success: true,
      conversationId: conversation._id.toString(),
      message: assistantMsgObj
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user conversations (optionally filtered by projectId)
// @route   GET /api/ai/conversations
// @access  Private
exports.getConversations = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id?.toString();
    const query = { userId };
    if (req.query.projectId) {
      query.projectId = req.query.projectId;
    }

    const conversations = await Conversation.find(query)
      .select('title projectId lastActive updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .limit(30);

    res.status(200).json({ success: true, data: conversations });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single conversation with all messages
// @route   GET /api/ai/conversations/:id
// @access  Private
exports.getConversation = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id?.toString();
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    if (conversation.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear or delete a conversation
// @route   DELETE /api/ai/conversations/:id
// @access  Private
exports.clearConversation = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id?.toString();
    const conversation = await Conversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    if (conversation.userId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    await Conversation.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Conversation deleted.' });
  } catch (error) {
    next(error);
  }
};

// @desc    Apply approved AI file changes to local filesystem
// @route   POST /api/ai/apply-changes
// @access  Private
exports.applyChanges = async (req, res, next) => {
  try {
    const { conversationId, messageId, projectId } = req.body;
    const userId = req.user.id || req.user._id?.toString();

    if (!conversationId || !messageId || !projectId) {
      return res.status(400).json({
        success: false,
        message: 'conversationId, messageId, and projectId are required to apply changes.'
      });
    }

    const project = await Project.findById(projectId);
    const conversation = await Conversation.findById(conversationId);

    const result = await AiFileApplyService.applyChanges({
      project,
      conversation,
      messageId,
      userId
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

// @desc    Reject proposed AI file changes
// @route   POST /api/ai/reject-changes
// @access  Private
exports.rejectChanges = async (req, res, next) => {
  try {
    const { conversationId, messageId } = req.body;
    const userId = req.user.id || req.user._id?.toString();

    if (!conversationId || !messageId) {
      return res.status(400).json({
        success: false,
        message: 'conversationId and messageId are required to reject changes.'
      });
    }

    const conversation = await Conversation.findById(conversationId);
    const result = await AiFileApplyService.rejectChanges({
      conversation,
      messageId,
      userId
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

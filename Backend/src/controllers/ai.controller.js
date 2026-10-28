const crypto = require('crypto');
const Conversation = require('../models/conversation.model');
const Project = require('../models/project.model');
const AiService = require('../services/ai.service');
const AiContextService = require('../services/ai-context.service');
const AiFileApplyService = require('../services/ai-file-apply.service');

// In-flight request deduplication map to prevent accidental duplicate submissions
// Key: `${userId}:${projectId || 'none'}:${operation || 'chat'}:${message.trim()}`
const inFlightRequests = new Map();

// @desc    Send a message to AI Chat with project awareness
// @route   POST /api/ai/chat
// @access  Private
exports.chat = async (req, res, next) => {
  let dedupKey = null;
  try {
    const { message, projectId, conversationId, activeFilePath, selectedCode, errorContext, operation } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message content is required.' });
    }

    if (message.length > 20000) {
      return res.status(400).json({ success: false, message: 'Message exceeds maximum allowed length (20,000 characters).' });
    }

    const userId = req.user.id || req.user._id?.toString();
    dedupKey = `${userId}:${projectId || 'none'}:${operation || 'chat'}:${message.trim()}`;

    if (inFlightRequests.has(dedupKey)) {
      return res.status(409).json({
        success: false,
        message: 'An identical AI request is already in progress. Please wait for it to complete.',
        code: 'DUPLICATE_IN_FLIGHT_REQUEST'
      });
    }

    inFlightRequests.set(dedupKey, Date.now());

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

    // 3. Gather project-aware context (both structured and rendered string)
    let projectContext = '';
    let structuredContext = null;
    if (project) {
      const built = await AiContextService.buildStructuredContext({
        project,
        activeFilePath,
        selectedCode,
        userPrompt: message,
        errorContext
      });
      projectContext = built.contextString;
      structuredContext = built.contextData;
    }

    // 4. Generate AI response from provider (Python Ollama with cloud fallback)
    const { content, proposal } = await AiService.generateResponse({
      userMessage: message,
      history: conversation.messages,
      projectContext,
      structuredContext,
      operation: operation || 'chat',
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
  } finally {
    if (dedupKey) {
      inFlightRequests.delete(dedupKey);
    }
  }
};

// @desc    Send a message to AI Chat with project awareness and SSE streaming
// @route   POST /api/ai/chat/stream
// @access  Private
exports.chatStream = async (req, res, next) => {
  const { message, projectId, conversationId, activeFilePath, selectedCode, errorContext, operation } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message content is required.' });
  }

  if (message.length > 20000) {
    return res.status(400).json({ success: false, message: 'Message exceeds maximum allowed length (20,000 characters).' });
  }

  const userId = req.user.id || req.user._id?.toString();
  const dedupKey = `${userId}:${projectId || 'none'}:${operation || 'chat'}:${message.trim()}`;

  if (inFlightRequests.has(dedupKey)) {
    return res.status(409).json({
      success: false,
      message: 'An identical AI request is already in progress. Please wait for it to complete.',
      code: 'DUPLICATE_IN_FLIGHT_REQUEST'
    });
  }

  inFlightRequests.set(dedupKey, Date.now());
  const abortController = new AbortController();

  req.on('close', () => {
    abortController.abort();
    inFlightRequests.delete(dedupKey);
  });

  try {
    let project = null;
    if (projectId) {
      project = await Project.findById(projectId);
      if (!project) {
        inFlightRequests.delete(dedupKey);
        return res.status(404).json({ success: false, message: 'Project not found.' });
      }
      if (project.ownerId.toString() !== userId) {
        inFlightRequests.delete(dedupKey);
        return res.status(403).json({ success: false, message: 'You do not have access to this project.' });
      }
    }

    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findById(conversationId);
      if (conversation && conversation.userId.toString() !== userId) {
        inFlightRequests.delete(dedupKey);
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

    let projectContext = '';
    let structuredContext = null;
    if (project) {
      const built = await AiContextService.buildStructuredContext({
        project,
        activeFilePath,
        selectedCode,
        userPrompt: message,
        errorContext
      });
      projectContext = built.contextString;
      structuredContext = built.contextData;
    }

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();

    let fullContent = '';
    let proposal = null;
    let evalCount = 0;
    let finishReason = 'stop';
    let modelName = 'qwen2.5-coder:3b';

    for await (const event of AiService.streamResponse({
      userMessage: message,
      history: conversation.messages,
      projectContext,
      structuredContext,
      operation: operation || 'chat',
      project,
      signal: abortController.signal
    })) {
      if (event.type === 'chunk') {
        fullContent += event.content || '';
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } else if (event.type === 'proposal') {
        proposal = event.proposal;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } else if (event.type === 'done') {
        evalCount = event.eval_count || 0;
        finishReason = event.finish_reason || 'stop';
        modelName = event.model || modelName;
      }
    }

    // Clean content and extract proposal if not extracted in stream
    if (!proposal) {
      const parsed = await AiService.parseAndValidateProposal(fullContent, project);
      fullContent = parsed.cleanText;
      proposal = parsed.proposal;
    } else {
      fullContent = fullContent.replace(/```devpilot-changes[\s\S]*?```/, '').trim();
    }

    // Persist conversation
    const userMsgObj = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    const assistantMsgObj = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: fullContent,
      timestamp: new Date(),
      proposal: proposal || null
    };

    conversation.messages.push(userMsgObj);
    conversation.messages.push(assistantMsgObj);
    conversation.lastActive = new Date();
    await conversation.save();

    res.write(`data: ${JSON.stringify({
      type: 'completed',
      conversationId: conversation._id.toString(),
      message: assistantMsgObj,
      eval_count: evalCount,
      finish_reason: finishReason,
      model: modelName
    })}\n\n`);
    res.end();
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }
    const errorMsg = error.message || 'Stream processing error';
    res.write(`data: ${JSON.stringify({ type: 'error', message: errorMsg, code: error.code || 'STREAM_ERROR' })}\n\n`);
    res.end();
  } finally {
    inFlightRequests.delete(dedupKey);
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

// @desc    Generate documentation proposal for project
// @route   POST /api/ai/generate-docs
// @access  Private
exports.generateDocs = async (req, res, next) => {
  try {
    const {
      projectId,
      docType = 'readme',
      title,
      instructions,
      sourceContent,
      targetPath,
      saveToHistory = true,
      model,
    } = req.body;
    const userId = req.user.id || req.user._id?.toString();

    if (!projectId) {
      return res.status(400).json({ success: false, message: 'projectId is required.' });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    if (project.ownerId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied to this project.' });
    }

    const DocumentService = require('../services/document.service');
    const result = await DocumentService.generateDocument({
      project,
      userId,
      docType,
      title,
      instructions,
      sourceContent,
      targetPath,
      saveToHistory,
      model,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

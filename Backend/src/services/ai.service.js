const crypto = require('crypto');
const path = require('path');
const FileSystemService = require('./filesystem.service');
const AiContextService = require('./ai-context.service');

class AiService {
  /**
   * Sanitizes, validates, and enriches proposal changes with current disk state (hashes, contents).
   */
  static async enrichAndValidateProposal(rawProposal, project) {
    if (!rawProposal || !Array.isArray(rawProposal.changes) || rawProposal.changes.length === 0) {
      return null;
    }

    const validatedChanges = [];

    for (const change of rawProposal.changes) {
      if (!change.path || typeof change.path !== 'string') continue;
      if (!change.operation || !['create', 'edit'].includes(change.operation)) continue;
      if (typeof change.content !== 'string') continue;

      // Normalize path
      let cleanPath = change.path.trim().replace(/\\/g, '/').replace(/^\.?\//, '');
      while (cleanPath.startsWith('./')) {
        cleanPath = cleanPath.slice(2);
      }
      if (cleanPath.startsWith('/')) {
        cleanPath = cleanPath.replace(/^\/+/, '');
      }

      // Reject dangerous paths: traversal, absolute, drives
      if (!cleanPath || cleanPath.includes('..') || path.isAbsolute(cleanPath) || (cleanPath.length > 1 && cleanPath[1] === ':')) {
        continue;
      }

      // Reject secret paths
      if (AiContextService.isSecretPath(cleanPath)) {
        continue;
      }

      let originalContent = '';
      let originalHash = '';

      if (project && project.localPath) {
        try {
          if (await FileSystemService.exists(project.localPath, cleanPath)) {
            originalContent = await FileSystemService.readFile(project.localPath, cleanPath);
            originalHash = crypto.createHash('sha256').update(originalContent).digest('hex');
          }
        } catch {
          // File doesn't exist
        }
      }

      validatedChanges.push({
        path: cleanPath,
        operation: change.operation,
        content: change.content,
        originalContent: change.originalContent || change.original_content || originalContent,
        originalHash: change.originalHash || change.original_hash || originalHash,
        explanation: change.explanation || rawProposal.explanation || ''
      });
    }

    if (validatedChanges.length === 0) {
      return null;
    }

    return {
      summary: rawProposal.summary || 'Proposed code changes',
      explanation: rawProposal.explanation || '',
      status: 'pending',
      changes: validatedChanges
    };
  }

  /**
   * Extracts and validates structured changes from AI response text
   */
  static async parseAndValidateProposal(text, project) {
    if (!text || typeof text !== 'string') return { cleanText: '', proposal: null };

    // Regex looking for ```devpilot-changes ... ```
    const match = text.match(/```devpilot-changes\s*([\s\S]*?)\s*```/);
    if (!match) return { cleanText: text, proposal: null };

    const jsonStr = match[1].trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.warn('[AiService] Failed to parse devpilot-changes JSON block:', e.message);
      return { cleanText: text, proposal: null };
    }

    const proposal = await this.enrichAndValidateProposal(parsed, project);
    const cleanText = text.replace(/```devpilot-changes[\s\S]*?```/, '').trim();

    return {
      cleanText: cleanText || parsed?.explanation || proposal?.summary || text,
      proposal
    };
  }

  /**
   * Calls the local DevPilot Python AI service (backed by Ollama)
   */
  static async callPythonAiService({
    userMessage,
    history = [],
    projectContext = '',
    structuredContext = null,
    operation = 'chat',
    model,
    project = null
  }) {
    const pythonUrl = (process.env.PYTHON_AI_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
    const endpoint = `${pythonUrl}/api/chat`;

    // Map conversation history
    const conversationMessages = [];
    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
        conversationMessages.push({
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: msg.content
        });
      }
    }

    const payload = {
      message: userMessage,
      operation: operation || 'chat',
      history: conversationMessages,
      context_data: structuredContext || undefined,
      project_context: structuredContext ? '' : (projectContext || ''),
      model: model || process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b'
    };

    const timeoutSec = parseInt(process.env.OLLAMA_TIMEOUT_SECONDS || process.env.AI_TIMEOUT_SECONDS || '120', 10);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.INTERNAL_AI_SECRET ? { 'X-Internal-Secret': process.env.INTERNAL_AI_SECRET } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        const timeoutError = new Error(`Local AI inference timed out after ${timeoutSec} seconds. The model may be busy under heavy load.`);
        timeoutError.code = 'OLLAMA_TIMEOUT';
        timeoutError.status = 504;
        throw timeoutError;
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        const netError = new Error(
          `Cannot connect to DevPilot Python AI service at ${pythonUrl}. Please ensure the Python service is running on port 8001.`
        );
        netError.code = 'AI_SERVICE_UNREACHABLE';
        netError.status = 503;
        throw netError;
      }
      const netError = new Error('Failed to connect to Python AI service: ' + err.message);
      netError.code = 'NETWORK_ERROR';
      netError.status = 502;
      throw netError;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      let errorBody = {};
      try {
        errorBody = await res.json();
      } catch { /* ignore */ }

      const code = errorBody.code || 'AI_SERVICE_ERROR';
      const msg = errorBody.message || errorBody.detail || res.statusText || 'AI inference error';

      const err = new Error(msg);
      err.code = code;
      err.status = res.status >= 500 && res.status !== 503 && res.status !== 504 ? 502 : res.status;
      throw err;
    }

    const data = await res.json();
    let content = data.content || '';
    let proposal = null;

    if (data.proposal) {
      proposal = await this.enrichAndValidateProposal(data.proposal, project);
      content = content.replace(/```devpilot-changes[\s\S]*?```/, '').trim();
    } else {
      const parsed = await this.parseAndValidateProposal(content, project);
      content = parsed.cleanText;
      proposal = parsed.proposal;
    }

    return {
      content,
      proposal,
      model: data.model || payload.model
    };
  }

  /**
   * Generates or revises project documentation using Python AI service
   */
  static async generateDocumentation({
    project,
    docType = 'readme',
    title,
    instructions,
    sourceContent,
    audience,
    tone,
    length,
    includeProjectContext = true,
    currentContent,
    revisionInstruction,
    model
  }) {
    if (!project) {
      const err = new Error('Project context is required to generate documentation.');
      err.status = 400;
      throw err;
    }

    const pythonUrl = (process.env.PYTHON_AI_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
    const endpoint = `${pythonUrl}/api/docs/generate`;

    let treeStr = '';
    const keyFiles = {};

    if (includeProjectContext && project.localPath) {
      try {
        const ignoreRules = await AiContextService.loadIgnoreRules(project.localPath);
        const tree = await AiContextService.buildProjectTree(project.localPath, ignoreRules);
        treeStr = AiContextService.formatTreeString(tree);

        for (const candidate of ['package.json', 'README.md', 'index.html', 'src/main.ts', 'src/app.js']) {
          if (await FileSystemService.exists(project.localPath, candidate)) {
            const content = await AiContextService.safeReadFile(project.localPath, candidate, 4000);
            if (content) keyFiles[candidate] = content;
          }
        }
      } catch (err) {
        console.warn('[AiService] Error gathering project context for docs:', err.message);
      }
    }

    const payload = {
      project_name: project.name,
      technology: project.technology || '',
      doc_type: docType || 'readme',
      title: title || undefined,
      instructions: instructions || undefined,
      source_content: sourceContent || undefined,
      audience: audience || undefined,
      tone: tone || undefined,
      length: length || undefined,
      include_project_context: includeProjectContext !== undefined ? includeProjectContext : true,
      current_content: currentContent || undefined,
      revision_instruction: revisionInstruction || undefined,
      project_tree: treeStr,
      key_files: keyFiles,
      model: model || process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b'
    };

    const timeoutSec = parseInt(process.env.OLLAMA_TIMEOUT_SECONDS || process.env.AI_TIMEOUT_SECONDS || '120', 10);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.INTERNAL_AI_SECRET ? { 'X-Internal-Secret': process.env.INTERNAL_AI_SECRET } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        const timeoutError = new Error('AI documentation generation timed out.');
        timeoutError.code = 'OLLAMA_TIMEOUT';
        timeoutError.status = 504;
        throw timeoutError;
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        const netError = new Error(`Cannot connect to DevPilot Python AI service at ${pythonUrl}.`);
        netError.code = 'AI_SERVICE_UNREACHABLE';
        netError.status = 503;
        throw netError;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      let errBody = {};
      try { errBody = await res.json(); } catch {}
      const err = new Error(errBody.message || errBody.detail || 'Failed to generate documentation');
      err.code = errBody.code || 'DOC_GENERATION_FAILED';
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    let proposal = null;
    if (data.proposal) {
      proposal = await this.enrichAndValidateProposal(data.proposal, project);
    }

    return {
      docType: data.doc_type,
      title: data.title || title || data.doc_type,
      content: data.content,
      proposal,
      model: data.model
    };
  }

  /**
   * Streams response from local Python AI service as an async generator of parsed SSE event objects
   */
  static async *streamPythonAiService({
    userMessage,
    history = [],
    projectContext = '',
    structuredContext = null,
    operation = 'chat',
    model,
    signal
  }) {
    const pythonUrl = (process.env.PYTHON_AI_URL || 'http://127.0.0.1:8001').replace(/\/$/, '');
    const endpoint = `${pythonUrl}/api/chat/stream`;

    const conversationMessages = [];
    const recentHistory = history.slice(-10);
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system') {
        conversationMessages.push({
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: msg.content
        });
      }
    }

    const payload = {
      message: userMessage,
      operation: operation || 'chat',
      history: conversationMessages,
      context_data: structuredContext || undefined,
      project_context: structuredContext ? '' : (projectContext || ''),
      model: model || process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b'
    };

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.INTERNAL_AI_SECRET ? { 'X-Internal-Secret': process.env.INTERNAL_AI_SECRET } : {})
        },
        body: JSON.stringify(payload),
        signal
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutError = new Error('AI stream was aborted or timed out.');
        timeoutError.code = 'OLLAMA_ABORTED';
        timeoutError.status = 499;
        throw timeoutError;
      }
      if (err.cause?.code === 'ECONNREFUSED' || err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
        const netError = new Error(
          `Cannot connect to DevPilot Python AI service at ${pythonUrl}. Please ensure the Python service is running on port 8001.`
        );
        netError.code = 'AI_SERVICE_UNREACHABLE';
        netError.status = 503;
        throw netError;
      }
      throw err;
    }

    if (!res.ok) {
      let errBody = {};
      try { errBody = await res.json(); } catch {}
      const err = new Error(errBody.message || errBody.detail || 'Streaming AI inference error');
      err.code = errBody.code || 'AI_SERVICE_ERROR';
      err.status = res.status;
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6);
            try {
              const eventObj = JSON.parse(jsonStr);
              yield eventObj;
            } catch {
              // Ignore incomplete lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Main chat invocation method — local Ollama inference exclusively via Python AI service
   */
  static async generateResponse({
    userMessage,
    history = [],
    projectContext = '',
    structuredContext = null,
    operation = 'chat',
    project = null
  }) {
    return await this.callPythonAiService({
      userMessage,
      history,
      projectContext,
      structuredContext,
      operation,
      model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
      project
    });
  }

  /**
   * Streaming response generator with proposal validation
   */
  static async *streamResponse({
    userMessage,
    history = [],
    projectContext = '',
    structuredContext = null,
    operation = 'chat',
    project = null,
    signal
  }) {
    for await (const event of this.streamPythonAiService({
      userMessage,
      history,
      projectContext,
      structuredContext,
      operation,
      model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
      signal
    })) {
      if (event.type === 'proposal' && event.proposal) {
        event.proposal = await this.enrichAndValidateProposal(event.proposal, project);
      }
      yield event;
    }
  }
}

module.exports = AiService;

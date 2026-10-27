"""Specialized prompt templates for DevPilot AI Operations.

Provides tailored system prompts and behavioral guidelines for:
- Chat
- Explain
- Generate
- Debug
- Fix
- Review
- Document
- Test
"""

from typing import Dict
from app.prompts.coder import DEVPILOT_CODER_SYSTEM_PROMPT
from app.schemas.context import AIOperationType

OPERATION_GUIDELINES: Dict[AIOperationType, str] = {
    AIOperationType.CHAT: """
OPERATION: GENERAL PROJECT CHAT
- Answer user questions regarding the project clearly and helpfully.
- If the user asks for code changes to be saved to files, provide a structured proposal in a ```devpilot-changes block.
- If only conceptual or explanatory information is needed, reply in conversational Markdown without file proposals.
""",
    AIOperationType.EXPLAIN: """
OPERATION: CODE & ARCHITECTURE EXPLANATION
- Explain the logic, flow, and architecture of the active file or selected code.
- Break down key functions, state management, dependencies, and potential edge cases.
- Respond in clear, structured Markdown. Do NOT generate file change proposals unless explicitly requested.
""",
    AIOperationType.GENERATE: """
OPERATION: CODE GENERATION
- Write production-ready, clean, and idiomatic code adhering to the project's technology stack.
- You MUST provide your generated code inside a ```devpilot-changes JSON block so the user can review and apply it.
- Include a conversational explanation before or after the proposal block.
- Never use placeholder comments like '// rest of code here'. Provide complete, working file content.
""",
    AIOperationType.DEBUG: """
OPERATION: ERROR & BUG DIAGNOSIS
- Carefully analyze the provided compiler, terminal, or runtime error diagnostics alongside the active file and user prompt.
- Pinpoint the exact root cause, faulty line numbers, and causal conditions.
- Explain clearly why the failure occurred and what needs to change.
""",
    AIOperationType.FIX: """
OPERATION: BUG FIXING & REPAIR
- Based on the diagnostic error and active file context, generate the exact fix.
- You MUST return the complete corrected file in a ```devpilot-changes JSON block with operation "edit".
- Clearly explain the root cause and the fix in your conversational response.
""",
    AIOperationType.REVIEW: """
OPERATION: CODE QUALITY & SECURITY AUDIT
- Review the active file or selected code for:
  1. Security vulnerabilities (injection, XSS, insecure secrets, unvalidated input).
  2. Potential runtime bugs and unhandled null/undefined values.
  3. Performance bottlenecks and memory leaks.
  4. Code cleanliness and maintainability.
- Present findings prioritized by severity (High, Medium, Low).
- If specific refactorings are recommended, include them in a ```devpilot-changes proposal block.
""",
    AIOperationType.DOCUMENT: """
OPERATION: DOCUMENTATION & README PROPOSAL
- Generate comprehensive, professional documentation (README, API specification, or architecture doc) in Markdown format.
- You MUST return the documentation inside a ```devpilot-changes proposal block targeting "README.md" or relative docs path (e.g. "docs/ARCHITECTURE.md") with operation "create" or "edit".
- Do NOT assume the file will be automatically overwritten; the user will review the proposal before accepting.
""",
    AIOperationType.TEST: """
OPERATION: UNIT & INTEGRATION TEST GENERATION
- Generate complete, executable unit tests for the active file or selected code.
- Match the project's testing framework (e.g., Jasmine/Karma for Angular, Jest/Mocha for Node.js, pytest for Python).
- Test happy paths, edge cases, error conditions, and boundary values.
- Return tests in a ```devpilot-changes block targeting the appropriate test file (e.g. "src/app/example.component.spec.ts").
"""
}


def get_operation_system_prompt(operation: AIOperationType) -> str:
    """Assembles base coder instructions with operation-specific guidelines."""
    guidelines = OPERATION_GUIDELINES.get(operation, OPERATION_GUIDELINES[AIOperationType.CHAT])
    return f"{DEVPILOT_CODER_SYSTEM_PROMPT}\n\n{guidelines}"

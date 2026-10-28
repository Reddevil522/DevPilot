"""DevPilot AI - Specialized Document Generation Prompts.

Provides structured prompt templates and behavioral guidelines for:
- README
- API Reference
- System Architecture
- Code Overview
- Deployment Guide
- Project Proposal
- Technical / Analytical Report
- Meeting Notes
- Study Notes
- Business Document
- Custom Document
"""

from typing import Dict, List, Optional, Tuple
from app.schemas.docs import DocRequest, DocType

DOC_SYSTEM_PROMPT = """You are DevPilot AI, an elite technical documentation specialist and software architect embedded in the DevPilot IDE.
Your task is to generate professional, well-structured, production-ready documentation in clean GitHub Flavored Markdown.

CRITICAL QUALITY GUIDELINES:
1. STRUCTURE & HEADINGS: Use clear, organized Markdown headings (#, ##, ###). Start with a useful document title as the H1 heading.
2. ACCURACY: Strictly preserve all user-provided facts, project names, technical parameters, and supplied source code/content.
3. NO HALLUCINATIONS: Do NOT invent unverified external URLs, fake statistics, or unverifiable claims. If required details are not provided, explicitly state the reasonable assumptions made.
4. NO LAZY PLACEHOLDERS: Provide complete, thorough explanations. Never use lazy truncation comments like '// rest of code here', 'TODO: add more', or '[insert details]'.
5. PRACTICAL CODE & EXAMPLES: When code examples or commands are needed, write working, accurate snippets matching the project's actual technology stack.
6. FORMATTING: Use tables, bullet points, bold key terms, and language-tagged code blocks (```typescript, ```json, ```bash, etc.) for high readability.
7. DIRECT OUTPUT: Provide the Markdown document content directly. Do not wrap the entire document in outer markdown code fences (no leading ````markdown or trailing ````).
"""

DOC_SECTION_TEMPLATES: Dict[DocType, List[str]] = {
    DocType.README: [
        "Project Overview & Purpose",
        "Key Features & Capabilities",
        "Architecture & Technology Stack",
        "Prerequisites & System Requirements",
        "Installation & Setup Guide",
        "Running the Application (Development & Production)",
        "Environment Variables & Configuration",
        "Project Structure",
        "Available Scripts / Commands",
        "Contributing & License",
    ],
    DocType.API: [
        "Overview & Base URL",
        "Authentication & Security Headers",
        "Common Response Formats & Error Codes",
        "Endpoints Reference (Method, Path, URL Parameters, Request Body, Response Schema, Example)",
        "Rate Limiting & Usage Guidelines",
    ],
    DocType.ARCHITECTURE: [
        "System Overview & High-Level Design",
        "Architecture Topology & Component Responsibilities",
        "Data Flow & Processing Lifecycle",
        "Data Persistence, Storage & State Models",
        "Security Architecture & Isolation Boundaries",
        "Scalability, Reliability & Error Recovery",
    ],
    DocType.CODE: [
        "Codebase Directory Layout",
        "Core Services & State Management Architecture",
        "Design Patterns & Coding Conventions",
        "Key Interfaces, Classes & Data Contracts",
        "Error Handling & Logging Strategy",
        "Testing Conventions & Test Structure",
    ],
    DocType.DEPLOYMENT: [
        "Deployment Overview & Environments",
        "Prerequisites & Target Infrastructure",
        "Environment Variables & Secrets Management",
        "Build & Packaging Instructions",
        "Containerization (Docker / Compose)",
        "Production Launch & Health Verification",
        "Monitoring, Logging & Rollback Procedure",
    ],
    DocType.PROPOSAL: [
        "Executive Summary",
        "Problem Statement & Objectives",
        "Proposed Solution & Technical Approach",
        "Deliverables & Implementation Roadmap",
        "Resource Requirements & Tech Stack",
        "Risk Analysis & Mitigation Strategies",
        "Success Criteria & Key Metrics",
    ],
    DocType.REPORT: [
        "Executive Summary",
        "Context & Objectives",
        "Methodology & Analysis",
        "Key Findings & Observations",
        "Challenges & Technical Considerations",
        "Strategic Recommendations & Next Steps",
    ],
    DocType.MEETING_NOTES: [
        "Meeting Details (Date, Topic, Participants, Facilitator)",
        "Meeting Objective & Agenda",
        "Key Discussion Points",
        "Decisions Reached",
        "Action Items Table (Task, Assignee, Due Date, Status)",
        "Open Questions & Next Meeting",
    ],
    DocType.STUDY_NOTES: [
        "Topic Overview & Learning Objectives",
        "Core Concepts & Terminology",
        "In-Depth Breakdown & Explanations",
        "Practical Examples / Code Samples",
        "Common Pitfalls & Key Takeaways",
        "Self-Assessment / Review Questions",
    ],
    DocType.BUSINESS: [
        "Executive Overview",
        "Business Context & Market Need",
        "Operational Workflow & Process Architecture",
        "Governance, Compliance & Resource Allocation",
        "Implementation Plan & Success Milestones",
    ],
    DocType.CUSTOM: [
        "Document Overview",
        "Detailed Sections based on User Instructions",
        "Technical Considerations",
        "Summary & Conclusion",
    ],
}


def build_document_prompt(
    request: DocRequest,
    context_str: str = ""
) -> Tuple[str, str, int, int]:
    """Builds a tailored user instruction prompt, system prompt, max_tokens, and num_ctx.

    Returns:
        (user_prompt, system_prompt, max_tokens, num_ctx)
    """
    # 1. Determine token budget and context window for 8 GB RAM constraints
    length_lower = (request.length or "medium").lower().strip()
    if "short" in length_lower or "brief" in length_lower or "concise" in length_lower:
        max_tokens = 512
        num_ctx = 2048
    elif "comp" in length_lower or "long" in length_lower or "detailed" in length_lower:
        max_tokens = 2048
        num_ctx = 4096
    else:  # default "medium"
        max_tokens = 1024
        num_ctx = 4096

    # 2. Check if revision
    if request.current_content and request.revision_instruction:
        task_parts = [
            f"=== DOCUMENTATION REVISION TASK ===",
            f"Project: '{request.project_name}'",
            f"Document Type: {request.doc_type.value.upper()}",
            f"Title: {request.title or request.doc_type.value}",
        ]
        if request.tone:
            task_parts.append(f"Desired Tone: {request.tone}")
        if request.audience:
            task_parts.append(f"Target Audience: {request.audience}")

        task_parts.extend([
            f"\n--- EXISTING DOCUMENT CONTENT ---\n{request.current_content.strip()}",
            f"\n--- USER REVISION INSTRUCTIONS ---\n{request.revision_instruction.strip()}",
            "\nREVISION REQUIREMENTS:",
            "1. Carefully apply the user's revision instructions to update the document.",
            "2. Preserve existing valid sections, accurate details, and overall structure.",
            "3. Output the complete, updated Markdown document.",
        ])

        user_prompt = f"{context_str}\n\n" + "\n\n".join(task_parts) if context_str else "\n\n".join(task_parts)
        return user_prompt, DOC_SYSTEM_PROMPT, max_tokens, num_ctx

    # 3. New Document Generation
    sections = DOC_SECTION_TEMPLATES.get(request.doc_type, DOC_SECTION_TEMPLATES[DocType.CUSTOM])
    section_list_str = "\n".join(f"- {s}" for s in sections)

    task_parts = [
        f"=== DOCUMENTATION TASK ===",
        f"Generate a professional, production-grade {request.doc_type.value.upper()} document for project '{request.project_name}'.",
        f"Target Document Type: {request.doc_type.value}",
    ]

    resolved_title = request.title or f"{request.project_name} - {request.doc_type.value.upper()}"
    task_parts.append(f"Suggested Title: {resolved_title}")

    if request.audience:
        task_parts.append(f"Target Audience: {request.audience}")
    if request.tone:
        task_parts.append(f"Tone: {request.tone}")
    if request.length:
        task_parts.append(f"Desired Depth / Length: {request.length}")

    if request.instructions:
        task_parts.append(f"USER SPECIFIC INSTRUCTIONS:\n{request.instructions.strip()}")

    if request.source_content:
        task_parts.append(f"USER SUPPLIED SOURCE CONTENT / REFERENCE:\n{request.source_content.strip()}")

    task_parts.extend([
        f"RECOMMENDED SECTION OUTLINE:\n{section_list_str}",
        "\nEXECUTION INSTRUCTIONS:",
        "1. Generate a comprehensive, properly structured Markdown document starting with the top-level H1 header.",
        "2. Follow the recommended section outline where relevant, adapting appropriately to the project context.",
        "3. Incorporate all user-supplied facts and source content accurately.",
        "4. Provide realistic, runnable examples and concrete details rather than generic placeholders.",
    ])

    user_prompt = f"{context_str}\n\n" + "\n\n".join(task_parts) if context_str else "\n\n".join(task_parts)
    return user_prompt, DOC_SYSTEM_PROMPT, max_tokens, num_ctx


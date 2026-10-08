import { Injectable, signal } from '@angular/core';
import { Observable, of, delay } from 'rxjs';
import { AIMessage, AIContext, DocumentationType } from '../../shared/models/ai.model';

const AI_RESPONSES: Record<string, string> = {
  explain: `This function implements the **JWT authentication middleware**. It:

1. Extracts the Bearer token from the \`Authorization\` header
2. Verifies the token signature using the \`JWT_SECRET\` environment variable
3. Attaches the decoded user payload to \`req.user\` for downstream handlers
4. Throws a \`401 Unauthorized\` error if the token is missing, expired, or invalid

This is a stateless authentication pattern — no session storage is needed on the server.`,
  fix: `I found 2 issues in your code:

\`\`\`typescript
// ❌ Before — possible null reference
const user = users.find(u => u.id === id);
user.name = 'updated'; // will throw if not found

// ✅ After — safe optional chaining
const user = users.find(u => u.id === id);
if (user) {
  user.name = 'updated';
}
\`\`\``,
  refactor: `Here's a refactored version using modern TypeScript patterns:

\`\`\`typescript
// Clean, typed, async/await version
async function getUser(id: string): Promise<User | null> {
  try {
    const user = await UserModel.findById(id).select('-password').lean();
    return user ?? null;
  } catch {
    return null;
  }
}
\`\`\``,
  tests: `Generated test suite:

\`\`\`typescript
describe('AuthService', () => {
  it('should return 401 for invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bad@email.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('should return user on valid login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'Password123!' });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
  });
});
\`\`\``,
  default: `I'm analyzing your code and project context...

Based on the current file and project structure, I can help you with:
- **Explaining** complex logic and patterns
- **Fixing** bugs and type errors
- **Refactoring** for better performance and readability
- **Generating** tests, documentation, and boilerplate

What would you like me to help with?`
};

@Injectable({ providedIn: 'root' })
export class AiService {
  readonly isThinking = signal(false);
  readonly isPanelOpen = signal(false);
  readonly context = signal<AIContext>({
    projectName: 'E-Commerce API',
    projectId: '1',
    currentFile: 'src/app.ts'
  });

  sendMessage(message: string, _context: AIContext): Observable<AIMessage> {
    this.isThinking.set(true);
    const lower = message.toLowerCase();
    let content = AI_RESPONSES['default'];

    if (lower.includes('explain') || lower.includes('what')) content = AI_RESPONSES['explain'];
    else if (lower.includes('fix') || lower.includes('error') || lower.includes('bug')) content = AI_RESPONSES['fix'];
    else if (lower.includes('refactor') || lower.includes('improve')) content = AI_RESPONSES['refactor'];
    else if (lower.includes('test')) content = AI_RESPONSES['tests'];

    const response: AIMessage = {
      id: String(Date.now()),
      role: 'assistant',
      content,
      timestamp: new Date()
    };

    return of(response).pipe(
      delay(1200 + Math.random() * 800)
    );
  }

  generateDocumentation(projectId: string, type: DocumentationType): Observable<string> {
    this.isThinking.set(true);
    const docs: Record<DocumentationType, string> = {
      readme: `# E-Commerce API\n\nA robust RESTful API built with Node.js, Express, and MongoDB.\n\n## Features\n- JWT Authentication\n- Product Management\n- Order Processing\n- Payment Integration\n\n## Quick Start\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Environment Variables\n\nCopy \`.env.example\` to \`.env\` and configure your values.`,
      api: `# API Reference\n\n## Authentication\n\n### POST /api/auth/login\nAuthenticates a user and returns JWT tokens.\n\n**Request Body:**\n\`\`\`json\n{\n  "email": "user@example.com",\n  "password": "Password123!"\n}\n\`\`\`\n\n**Response:**\n\`\`\`json\n{\n  "success": true,\n  "user": { "id": "...", "name": "..." }\n}\n\`\`\``,
      code: `# Code Documentation\n\nGenerated documentation for 24 functions across 8 files.\n\n## auth.controller.ts\n\n### \`login(req, res)\`\nHandles user authentication. Validates credentials against the database and issues JWT tokens via secure HttpOnly cookies.\n\n**Parameters:** \`req: Request\`, \`res: Response\`\n**Returns:** \`void\``,
      architecture: `# Architecture Overview\n\n## System Design\n\nThis API follows a **layered architecture** pattern:\n\n\`\`\`\nClient → Routes → Controllers → Services → Models → MongoDB\n\`\`\`\n\n## Components\n- **Routes**: Express router definitions\n- **Controllers**: Request/response handling\n- **Services**: Business logic\n- **Models**: Mongoose schemas`,
      deployment: `# Deployment Guide\n\n## Prerequisites\n- Node.js 18+\n- MongoDB Atlas account\n- DevPilot account\n\n## Deploy to DevPilot\n\n1. Connect your repository\n2. Set environment variables\n3. Click **Deploy**\n\n## Environment Variables\n\n| Key | Description |\n|-----|-------------|\n| \`MONGODB_URI\` | MongoDB connection string |\n| \`JWT_SECRET\` | JWT signing secret |`
    };

    return of(docs[type] || docs['readme']).pipe(delay(2500));
  }

  updateContext(ctx: Partial<AIContext>): void {
    this.context.update((c) => ({ ...c, ...ctx }));
  }

  togglePanel(): void {
    this.isPanelOpen.update((v) => !v);
  }

  stopThinking(): void {
    this.isThinking.set(false);
  }
}

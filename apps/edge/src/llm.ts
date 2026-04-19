import type {
  CanonicalQuestion,
  ConversationTurn,
  ToolName,
} from "@academic-homepage/shared";

import type { Env } from "./env.ts";
import { describeToolEvent, executeTool, toolDefinitions } from "./tools.ts";

interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: ToolName;
    arguments: string;
  };
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface AnswerContext {
  env: Env;
  history: ConversationTurn[];
  userMessage: string;
  route: {
    question: CanonicalQuestion;
    score: number;
  };
  onTool: (hint: {
    name: ToolName;
    message: string;
  }) => void;
  onToken: (text: string) => void;
}

const DEFAULT_STREAM_DELAY_MS = 18;

function buildSystemPrompt(route: { question: CanonicalQuestion; score: number }) {
  const currentDate = new Date().toISOString().slice(0, 10);

  return [
    "role:",
    "- You are the owner of this personal homepage speaking directly to visitors through a retro terminal interface.",
    "- Answer as the owner of the site in first person.",
    "time:",
    `- Current date: ${currentDate} UTC.`,
    "- Use dates and periods in tool results to distinguish current status from past or future experience.",
    "- Do not describe an internship, project, award, or publication as current unless its period includes the current date or the tool payload explicitly says it is current.",
    "goal:",
    "- Help visitors quickly understand who I am, what I work on, what I have built or published, and how to contact me.",
    "scope:",
    "- Answer only about my profile, education, work experience, projects, publications, awards, skills, and public contact info.",
    "- If the request is outside this scope, output exactly: > ERR: COMMAND_OUT_OF_SCOPE.",
    "style:",
    "- English only. First-person singular (I/my).",
    "- Strict terminal stdout style. No Markdown, no code fences, no greetings, no filler.",
    "- Prefer compact natural lines. You may use > or - as line prefixes.",
    "- Avoid raw JSON, raw key:value dumps, and ASCII tables.",
    "- Default to 3 to 6 lines unless the user explicitly asks for more detail.",
    "content:",
    "- Lead with high-level capabilities or research/engineering focus, then support with concrete facts.",
    "- The knowledge data is written in neutral factual language; convert it into concise first-person answers.",
    "- Do not copy tool payloads line by line. Synthesize them into cohesive, human-readable terminal sentences.",
    "- When asked about projects, work, or publications, explain what I built, designed, studied, improved, or achieved.",
    "- When referring to publication years, use natural phrasing such as 'papers published in 2025' or 'my 2025 publications'. Do not use awkward forms like '2025 work'.",
    "- Use conversation history only to resolve follow-up references. Keep answers grounded in tools.",
    "- If a fact is missing from tool results, output exactly: > WARN: Info not found in registry.",
    "- Expose only public contact information returned by tools.",
    "tools:",
    "- Tool schemas are attached separately in the API request.",
    "- Available factual domains: profile, education, work experience, projects, publications, awards, skills, contact.",
    "- You must use tools whenever factual personal data is needed.",
    "- Rely strictly on tool payloads. Do not invent details from pre-trained knowledge.",
    "- You may combine multiple tools when useful, but keep the answer focused.",
    "- Do not mention internal function names, JSON payloads, or hidden reasoning.",
    "route:",
    `- intent: ${route.question.intent}`
  ].join("\n");
}

function safeJsonParse(input: string | undefined): Record<string, unknown> {
  if (!input) {
    return {};
  }

  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: string }).text ?? "");
      }
      return "";
    })
    .join("");
}

async function callChatCompletion(
  env: Env,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!env.LLM_BASE_URL || !env.LLM_MODEL) {
    throw new Error("llm endpoint not configured.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (env.LLM_API_KEY) {
    headers.Authorization = `Bearer ${env.LLM_API_KEY}`;
  }

  const response = await fetch(
    `${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: env.LLM_MODEL,
        ...body
      })
    }
  );

  if (!response.ok) {
    throw new Error(`upstream llm error: ${response.status}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

function getStreamDelayMs(env: Env) {
  const parsed = Number(env.LLM_STREAM_DELAY_MS ?? DEFAULT_STREAM_DELAY_MS);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_STREAM_DELAY_MS;
  }

  return parsed;
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function streamText(
  env: Env,
  text: string,
  onToken: (chunk: string) => void
) {
  const chunks = Array.from(text);
  const delayMs = getStreamDelayMs(env);

  for (const chunk of chunks) {
    onToken(chunk);
    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }
}

export async function generateAnswer(context: AnswerContext) {
  if (context.env.LLM_MOCK_MODE === "true") {
    throw new Error("llm unavailable. mock fallback disabled.");
  }

  if (!context.env.LLM_BASE_URL || !context.env.LLM_MODEL) {
    throw new Error("llm unavailable. upstream not configured.");
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(context.route)
    },
    ...context.history.flatMap((turn) => [
      {
        role: "user" as const,
        content: turn.user
      },
      {
        role: "assistant" as const,
        content: turn.assistant
      }
    ]),
    {
      role: "user",
      content: context.userMessage
    }
  ];

  for (let round = 0; round < 3; round += 1) {
    const completion = await callChatCompletion(context.env, {
      messages,
      tools: toolDefinitions,
      tool_choice: "auto",
      stream: false,
      temperature: 0.5
    });
    const choice = Array.isArray(completion.choices)
      ? completion.choices[0]
      : undefined;
    const assistantMessage = choice?.message as
      | (ChatMessage & { tool_calls?: ChatToolCall[] })
      | undefined;

    if (!assistantMessage) {
      throw new Error("missing assistant message.");
    }

    const toolCalls = assistantMessage.tool_calls ?? [];
    const content = readMessageContent(assistantMessage.content);

    if (toolCalls.length === 0) {
      await streamText(context.env, content, context.onToken);
      return;
    }

    messages.push({
      role: "assistant",
      content,
      tool_calls: toolCalls
    });

    for (const toolCall of toolCalls) {
      const args = safeJsonParse(toolCall.function.arguments);
      context.onTool({
        name: toolCall.function.name,
        message: describeToolEvent(toolCall.function.name)
      });
      const result = await executeTool(context.env, toolCall.function.name, args);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result)
      });
    }
  }

  throw new Error("tool loop exhausted.");
}

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
  return [
    "role:",
    "- terminal homepage agent for a PhD candidate and LLM application engineer",
    "goal:",
    "- help the visitor quickly understand who the owner is, what the owner works on, what has been built or published, and how to make contact",
    "scope:",
    "- answer only about the owner's profile, education, work experience, projects, publications, awards, skills, and public contact info",
    "- if the question drifts beyond the owner-specific scope, reply briefly and steer back to the owner's information",
    "style:",
    "- respond in English only",
    "- return terminal-style output, not chat-style output",
    "- speak in first person singular as the owner: use I / my",
    "- do not refer to the owner as he, she, or the owner in the final answer",
    "- no greeting, no markdown headings, no code fences, no filler",
    "- prefer compact ASCII lines, key:value fields, and short hyphen lists",
    "- default to 3 to 8 lines unless the user explicitly asks for more detail",
    "content:",
    "- start with high-level framing, then support it with concrete facts",
    "- use abstract capability framing first, then support with projects, publications, work experience, or awards",
    "- the knowledge data is written in neutral factual language; convert it into concise first-person answers",
    "- synthesize facts into a clean answer instead of copying tool payloads line by line",
    "- when asked about projects, work, or publications, explain what was built, designed, studied, or achieved",
    "- conversation history may be present; use it to resolve follow-up references, but keep answers grounded in tools",
    "- if a detail is not available in tool results, say so briefly instead of inventing it",
    "- expose only public contact information returned by tools",
    "tools:",
    "- tool schemas are attached separately in the API request",
    "- available factual domains: profile, education, work experience, projects, publications, awards, skills, contact",
    "- use tools whenever factual owner data is needed",
    "- you may combine multiple tools when useful, but keep the answer focused",
    "- do not mention internal function names, JSON payloads, or hidden reasoning",
    "route:",
    `- intent: ${route.question.intent}`,
    `- score: ${route.score.toFixed(2)}`
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
      temperature: 0.25
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

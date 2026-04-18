import type { SiteSnapshot } from "@academic-homepage/shared";

export type TerminalEntryKind =
  | "system"
  | "user"
  | "assistant"
  | "tool"
  | "error";

export interface TerminalEntry {
  id: string;
  kind: TerminalEntryKind;
  text: string;
  isTyping?: boolean;
}

export const BOOT_MESSAGE = "ready. press enter for /help.";

export interface CommandResult {
  type: "local" | "ask" | "clear";
  lines?: string[];
  question?: string;
}

const HELP_COLUMN_WIDTH = 15;

function formatHelpRow(label: string, description: string) {
  return `${label.padEnd(HELP_COLUMN_WIDTH, " ")} ${description}`;
}

export function createEntry(kind: TerminalEntryKind, text: string, isTyping?: boolean): TerminalEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    text,
    isTyping
  };
}

export function buildBootEntries(snapshot: SiteSnapshot): TerminalEntry[] {
  void snapshot;
  const lines = [BOOT_MESSAGE];

  return lines.map((line) => createEntry("system", line, true));
}

export function runCommand(
  rawInput: string,
  snapshot: SiteSnapshot
): CommandResult {
  const input = rawInput.trim();
  if (!input) {
    return {
      type: "local",
      lines: []
    };
  }

  if (!input.startsWith("/")) {
    return {
      type: "ask",
      question: input
    };
  }

  const [commandToken] = input.slice(1).split(/\s+/);
  const command = commandToken.toLowerCase();

  switch (command) {
    case "help":
      return {
        type: "local",
        lines: [
          "local",
          formatHelpRow("/help", "show local commands"),
          formatHelpRow("/about", "show brief profile"),
          formatHelpRow("/contact", "show public contact"),
          formatHelpRow("/clear", "clear terminal"),
          "",
          "query",
          formatHelpRow("plain text", "ask about profile, work, projects, papers, awards, or skills")
        ]
      };
    case "about":
      return {
        type: "local",
        lines: snapshot.aboutLines
      };
    case "contact":
      return {
        type: "local",
        lines: snapshot.contactLines
      };
    case "clear":
      return {
        type: "clear"
      };
    default:
      return {
        type: "local",
        lines: [
          `command not found: /${command}`,
          "hint: run /help"
        ]
      };
  }
}

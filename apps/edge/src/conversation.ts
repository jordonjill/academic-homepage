import type { ConversationTurn } from "@academic-homepage/shared";

export const MAX_CONVERSATION_TURNS = 5;
const ROUTE_HISTORY_TURNS = 2;
const ROUTE_ANSWER_SLICE = 240;

function normalizeTurn(turn: ConversationTurn): ConversationTurn | null {
  const user = turn.user.trim();
  const assistant = turn.assistant.trim();

  if (!user || !assistant) {
    return null;
  }

  return {
    user,
    assistant
  };
}

export function normalizeConversationHistory(
  history: ConversationTurn[] | undefined
): ConversationTurn[] {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .map((turn) => normalizeTurn(turn))
    .filter((turn): turn is ConversationTurn => turn !== null)
    .slice(-MAX_CONVERSATION_TURNS);
}

export function buildRouteInput(
  userMessage: string,
  history: ConversationTurn[]
) {
  const current = userMessage.trim();
  const recent = normalizeConversationHistory(history).slice(-ROUTE_HISTORY_TURNS);

  if (recent.length === 0) {
    return current;
  }

  return [
    ...recent.flatMap((turn) => [
      `previous question: ${turn.user}`,
      `previous answer: ${turn.assistant.slice(0, ROUTE_ANSWER_SLICE)}`
    ]),
    `current question: ${current}`
  ].join("\n");
}

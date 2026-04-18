import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CONVERSATION_TURNS,
  buildRouteInput,
  normalizeConversationHistory
} from "../apps/edge/src/conversation.ts";

test("normalizeConversationHistory trims empty turns and caps the list", () => {
  const history = normalizeConversationHistory([
    { user: "   ", assistant: "skip" },
    { user: "q1", assistant: "a1" },
    { user: "q2", assistant: "a2" },
    { user: "q3", assistant: "a3" },
    { user: "q4", assistant: "a4" },
    { user: "q5", assistant: "a5" },
    { user: "q6", assistant: "a6" }
  ]);

  assert.equal(history.length, MAX_CONVERSATION_TURNS);
  assert.deepEqual(history[0], { user: "q2", assistant: "a2" });
  assert.deepEqual(history.at(-1), { user: "q6", assistant: "a6" });
});

test("buildRouteInput includes recent conversational context for follow-up routing", () => {
  const routeInput = buildRouteInput("what about that project?", [
    {
      user: "Tell me about Academic Copilot.",
      assistant: "Academic Copilot is a multi-agent research assistant."
    }
  ]);

  assert.match(routeInput, /previous question: Tell me about Academic Copilot\./);
  assert.match(routeInput, /previous answer: Academic Copilot is a multi-agent research assistant\./);
  assert.match(routeInput, /current question: what about that project\?/);
});

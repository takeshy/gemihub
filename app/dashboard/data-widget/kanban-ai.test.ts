import assert from "node:assert/strict";
import test from "node:test";
import { parseKanbanAiTasks } from "./kanban-ai";

test("Kanban AI parser accepts fenced JSON", () => {
  assert.deepEqual(parseKanbanAiTasks(`\`\`\`json
[{"title":"Ship","description":"Check it","due":"2026-09-01","checklist":[{"text":"Test","completed":false}]}]
\`\`\``), [{
    title: "Ship", description: "Check it", due: "2026-09-01",
    checklist: [{ text: "Test", completed: false }],
  }]);
});

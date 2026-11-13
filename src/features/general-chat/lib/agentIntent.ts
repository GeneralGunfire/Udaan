// Signals that a prompt is asking the model to work with files rather than
// just chat — mirrors the schedule-action heuristic's approach (keyword
// signal, not a full NLU pass) since a false positive here just means the
// model is offered the workspace tools and doesn't use them, and a false
// negative means the user has to rephrase — both low-cost compared to
// running every single chat turn through tool-calling.
const AGENT_TASK_SIGNAL =
  /\b(file|files|workspace|folder|directory)\b.*\b(create|write|read|delete|list|make|save|open|remove)\b|\b(create|write|read|delete|list|make|save|remove)\b.*\b(file|files|workspace|folder|directory)\b/i

export function isAgentTaskRequest(prompt: string): boolean {
  return AGENT_TASK_SIGNAL.test(prompt)
}

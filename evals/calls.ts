/**
 * A question's tool calls, with the ones the CLI turned away before the server's tools were
 * there told apart from the model's own. On 2026-09-21, Claude Code 2.1.278 refused
 * Sonnet's first call in 13 of 49 questions with "No such tool available", naming a tool
 * the server serves, and the same call went through on the next try. That's the CLI's
 * timing, not the model's choice, so it isn't counted against the question.
 */

export interface Call {
  tool: string;
  input: unknown;
  error: boolean;
  /** What a failed call said, to read why. */
  message?: string;
}

const turnedAway = (call: Call, served: Set<string>) =>
  call.error && /No such tool available/.test(call.message ?? "") && served.has(call.tool);

/**
 * Only refusals that open the run are set aside. Once a call has gone through the tools
 * were there, so a later refusal is the model's, and so is one naming a tool the server
 * doesn't have.
 */
export function setAside(calls: Call[], served: Set<string>): { calls: Call[]; refused: Call[] } {
  let first = 0;
  while (first < calls.length && turnedAway(calls[first]!, served)) first += 1;
  return { calls: calls.slice(first), refused: calls.slice(0, first) };
}

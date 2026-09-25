/**
 * The setup a run reads: which model plays proposer and adversary, at what effort, how
 * many samples the proposer asks, and whether the adversary only sees the reasons a page
 * would show. The pilot chooses these by measurement and commits the result to
 * `insights/setup.json`; the full run only ever reads it.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Effort } from "./model.ts";

export type TransportName = "claude" | "ollama" | "gemini";

export interface Role {
  transport: TransportName;
  model: string;
  effort?: Effort;
}

export interface Setup {
  propose: Role & { samples: number };
  falsify: Role;
  attackShownOnly: boolean;
  decidedBy: string | null;
}

export const SETUP_PATH = "insights/setup.json";

const effortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
const transportSchema = z.enum(["claude", "ollama", "gemini"]);

const roleSchema = z.object({
  transport: transportSchema,
  model: z.string().min(1),
  effort: effortSchema.optional(),
});

const setupSchema = z
  .object({
    propose: roleSchema.extend({ samples: z.number().int().min(1).max(5) }),
    falsify: roleSchema,
    attackShownOnly: z.boolean(),
    decidedBy: z.string().nullable(),
  })
  .refine((setup) => setup.propose.transport !== setup.falsify.transport || setup.propose.model !== setup.falsify.model, {
    message: "the adversary can't be the proposer's own model (the same model): pick a different one",
  });

/** Parses an already-JSON-parsed setup, throwing a plain message (never a raw `ZodError`) on a bad shape or the same-model rule. */
export function parseSetup(json: unknown): Setup {
  const result = setupSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new Error(`insights/setup.json: ${path}${issue.message}`);
  }
  return result.data as Setup;
}

/** Reads and parses `path` (`SETUP_PATH` unless given), throwing a plain message when the file is missing, unparseable or invalid. */
export function readSetup(path: string = SETUP_PATH): Setup {
  return parseSetup(JSON.parse(readFileSync(path, "utf8")));
}

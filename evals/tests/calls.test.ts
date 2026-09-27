import { describe, expect, it } from "vitest";
import { setAside, type Call } from "../calls.ts";

const served = new Set(["search", "list_communes", "get_indicators"]);
const ok = (tool: string): Call => ({ tool, input: {}, error: false });
const refused = (tool: string): Call => ({
  tool,
  input: {},
  error: true,
  message: `<tool_use_error>Error: No such tool available: ${tool}</tool_use_error>`,
});

describe("calls the CLI turned away before the tools were there", () => {
  it("are set aside when they open the run and name a tool the server serves", () => {
    expect(setAside([refused("search"), ok("search"), ok("list_communes")], served)).toEqual({
      calls: [ok("search"), ok("list_communes")],
      refused: [refused("search")],
    });
  });

  it("stay counted once a call has gone through, since the tools were there by then", () => {
    const calls = [ok("search"), refused("list_communes"), ok("list_communes")];
    expect(setAside(calls, served)).toEqual({ calls, refused: [] });
  });

  it("stay counted when the tool doesn't exist, since that's the model's mistake", () => {
    const calls = [refused("get_water"), ok("get_indicators")];
    expect(setAside(calls, served)).toEqual({ calls, refused: [] });
  });

  it("stay counted when a call failed for any other reason", () => {
    const failed: Call = { tool: "search", input: {}, error: true, message: "q is required and cannot be empty" };
    expect(setAside([failed, ok("search")], served)).toEqual({ calls: [failed, ok("search")], refused: [] });
  });
});

/**
 * This server's entry for the official MCP Registry (registry.modelcontextprotocol.io),
 * in its 2025-12-11 schema. Glama and PulseMCP list what the registry lists.
 *
 *   mcp-publisher login github
 *   mcp-publisher publish dist/server.json
 *
 * The registry won't take the same version twice, and this one follows the dataset's.
 */
export const REGISTRY_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const REGISTRY_NAME = "io.github.zkousama/morocco-communes";

export function serverJson(opts: { siteUrl: string; version: string }) {
  return {
    $schema: REGISTRY_SCHEMA,
    name: REGISTRY_NAME,
    title: "Morocco communes",
    description: "Morocco's régions, provinces and communes: HCP codes, names, census population and boundaries",
    version: opts.version,
    repository: { url: "https://github.com/zkousama/morocco-communes", source: "github" },
    remotes: [{ type: "streamable-http", url: new URL("/mcp", opts.siteUrl).href }],
  };
}

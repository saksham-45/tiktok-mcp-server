/**
 * Tool registration for the TikTok MCP server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TikTokClient } from "../client.js";
import { registerDisplayTools } from "./display.js";
import { registerContentTools } from "./content.js";

export function registerTools(server: McpServer, client: TikTokClient): void {
  registerDisplayTools(server, client);
  registerContentTools(server, client);
}

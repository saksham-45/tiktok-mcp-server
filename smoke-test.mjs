/**
 * Smoke test: spawn the built server over stdio, exercise the MCP protocol.
 * No real TikTok credentials are used; tools should fail gracefully with the
 * "run npm run auth" guidance rather than crashing.
 *
 * MCP semantics: handler errors are returned as tool results with
 * isError: true (not thrown on the client side).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/index.js"],
  cwd: process.cwd(),
  env: {
    ...process.env,
    TIKTOK_CLIENT_KEY: "test-key",
    TIKTOK_CLIENT_SECRET: "test-secret",
  },
});

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
};

const tools = await client.listTools();
const toolNames = tools.tools.map((t) => t.name);
check("7 tools registered", toolNames.length === 7, toolNames.join(", "));

const resources = await client.listResources();
const templates = await client.listResourceTemplates();
const resNames = resources.resources.map((r) => r.name);
check(
  "2 static resources + 1 template registered",
  resNames.length === 2 &&
    templates.resourceTemplates.some((t) => t.uriTemplate === "tiktok://video/{video_id}"),
  `static: ${resNames.join(", ")} | templates: ${templates.resourceTemplates.map((t) => t.uriTemplate).join(", ")}`
);

const prompts = await client.listPrompts();
check("2 prompts registered", prompts.prompts.length === 2);

// 1. Read tool without tokens -> isError result with actionable guidance
{
  const res = await client.callTool({ name: "tiktok_get_user_info", arguments: {} });
  const text = (res.content ?? []).map((c) => c.text ?? "").join(" ");
  check("no-token error is graceful & actionable", res.isError === true && text.includes("npm run auth"), text.slice(0, 120));
}

// 2. Safety gate: DIRECT_POST without confirm=true rejected by schema
{
  const res = await client.callTool({
    name: "tiktok_create_post",
    arguments: { post_mode: "DIRECT_POST", title: "hi", video_url: "https://example.com/v.mp4" },
  });
  const text = (res.content ?? []).map((c) => c.text ?? "").join(" ");
  check("DIRECT_POST requires confirm=true", res.isError === true && text.includes("confirm=true"), text.slice(0, 120));
}

// 3. Source rule: exactly one of file_path | video_url
{
  const res = await client.callTool({
    name: "tiktok_create_post",
    arguments: { post_mode: "INBOX", file_path: "/tmp/a.mp4", video_url: "https://example.com/v.mp4" },
  });
  const text = (res.content ?? []).map((c) => c.text ?? "").join(" ");
  check("exactly-one-source enforced", res.isError === true && text.includes("exactly one of file_path"), text.slice(0, 120));
}

// 4. Prompt invocation returns messages
{
  const prompt = await client.getPrompt({
    name: "tiktok_post_from_brief",
    arguments: { brief: "AI agents are exploding in popularity" },
  });
  check("prompt returns messages", prompt.messages.length > 0);
}

// 5. Resource read without tokens -> graceful protocol error with guidance
{
  try {
    const res = await client.readResource({ uri: "tiktok://user" });
    const text = (res.contents ?? []).map((c) => c.text ?? "").join(" ");
    check("resource read returned content (unexpected without token)", false, text.slice(0, 100));
  } catch (err) {
    const text = String(err?.message ?? err);
    check("resource read is graceful (no crash)", text.includes("npm run auth"), text.slice(0, 120));
  }
}

// 6. Resource template URI pattern
{
  try {
    await client.readResource({ uri: "tiktok://video/12345" });
    check("video resource template matched (unexpected without token)", false);
  } catch (err) {
    const text = String(err?.message ?? err);
    check("video resource template matched", text.includes("npm run auth"), text.slice(0, 120));
  }
}

await client.close();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);

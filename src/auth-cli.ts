/**
 * CLI OAuth flow: `npm run auth`
 *
 * Spins up a local callback server, opens the TikTok authorization URL with a
 * PKCE challenge, exchanges the returned code for tokens, and persists them
 * to TIKTOK_TOKEN_FILE (default ./tiktok-tokens.json).
 *
 * Prerequisites: TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET, with Login Kit +
 * Content Posting API products and the video.publish scope approved.
 */

import { createServer } from "node:http";
import { exec } from "node:child_process";
import {
  loadAuthConfig,
  pkcePair,
  buildAuthUrl,
  exchangeCode,
  hasTokenFile,
} from "./auth.js";
import { AUTH_CALLBACK_PORT } from "./constants.js";

async function main(): Promise<void> {
  const cfg = loadAuthConfig();
  if (hasTokenFile(cfg.tokenFile)) {
    console.error(
      `Token file ${cfg.tokenFile} already exists. Delete it first to re-connect, ` +
        `or just keep using the existing tokens.`
    );
    process.exit(1);
  }

  const { verifier, challenge } = pkcePair();
  const url = buildAuthUrl(cfg, challenge);
  const redirect = new URL(cfg.redirectUri);
  const port = Number(redirect.port || AUTH_CALLBACK_PORT);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
      if (reqUrl.pathname !== redirect.pathname) {
        res.writeHead(404).end("Not found");
        return;
      }
      const codeParam = reqUrl.searchParams.get("code");
      if (!codeParam) {
        res
          .writeHead(400)
          .end(`Authorization failed: ${reqUrl.searchParams.get("error") ?? "no code"}`);
        reject(new Error(`Authorization failed: ${reqUrl.searchParams.toString()}`));
        return;
      }
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end("<h1>Connected to TikTok</h1><p>You can close this tab and return to the terminal.</p>");
      server.close();
      resolve(codeParam);
    });
    server.on("error", (err) => reject(err));
    server.listen(port, () => {
      console.error("Opening browser for TikTok authorization...");
      console.error(`If the browser does not open, visit:\n${url}`);
      const opener =
        process.platform === "darwin"
          ? `open "${url}"`
          : process.platform === "win32"
            ? `start "" "${url}"`
            : `xdg-open "${url}"`;
      exec(opener, () => { /* best-effort; the printed URL always works */ });
    });
  });

  const tokens = await exchangeCode(cfg, code, verifier);
  console.error(
    `Connected! Tokens saved to ${cfg.tokenFile}.\n` +
      `Scopes granted: ${tokens.scope}\n` +
      `Access token expires: ${new Date(tokens.expires_at * 1000).toISOString()}\n` +
      `Refresh token expires: ${new Date(tokens.refresh_expires_at * 1000).toISOString()}\n` +
      `Start the server with: npm start`
  );
}

main().catch((err) => {
  console.error(`Auth failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

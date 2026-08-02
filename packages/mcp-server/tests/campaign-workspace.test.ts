import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CAMPAIGN_WORKSPACE_HTML } from "../src/campaign-workspace-html.ts";

const APP_SOURCE = readFileSync(new URL("../ui/app.tsx", import.meta.url), "utf8");
const BRIDGE_SOURCE = readFileSync(new URL("../ui/bridge.ts", import.meta.url), "utf8");
const CLIENT_SOURCE = `${APP_SOURCE}\n${BRIDGE_SOURCE}`;

test("ships one self-contained standard MCP App without external resource access", () => {
  assert.match(CAMPAIGN_WORKSPACE_HTML, /ui\/initialize/u);
  assert.match(CAMPAIGN_WORKSPACE_HTML, /ui\/notifications\/initialized/u);
  assert.match(CAMPAIGN_WORKSPACE_HTML, /ui\/update-model-context/u);
  assert.match(CAMPAIGN_WORKSPACE_HTML, /tools\/call/u);
  assert.doesNotMatch(CAMPAIGN_WORKSPACE_HTML, /<script[^>]+src=/iu);
  assert.doesNotMatch(CAMPAIGN_WORKSPACE_HTML, /<link[^>]+href=/iu);
  assert.doesNotMatch(CAMPAIGN_WORKSPACE_HTML, /\bfetch\s*\(/u);
  assert.doesNotMatch(CAMPAIGN_WORKSPACE_HTML, /\b(?:localStorage|sessionStorage|document\.cookie)\b/u);
  assert.doesNotMatch(CLIENT_SOURCE, /dangerouslySetInnerHTML/u);
  assert.doesNotMatch(CLIENT_SOURCE, /\bfetch\s*\(/u);
  assert.doesNotMatch(CLIENT_SOURCE, /\b(?:localStorage|sessionStorage|document\.cookie)\b/u);
  assert.doesNotMatch(CLIENT_SOURCE, /\b(?:eval|Function)\s*\(/u);
});

test("keeps external launch execution outside the interactive view", () => {
  assert.match(APP_SOURCE, /toolName = "campaign_validate"/u);
  assert.match(APP_SOURCE, /toolName = "audience_preview"/u);
  assert.match(APP_SOURCE, /toolName = "campaign_prepare"/u);
  assert.match(APP_SOURCE, /toolName = "campaign_launch_preflight"/u);
  assert.doesNotMatch(APP_SOURCE, /toolName = "campaign_launch";/u);
  assert.doesNotMatch(APP_SOURCE, /toolName = "campaign_pause";/u);
  assert.match(CAMPAIGN_WORKSPACE_HTML, /Prepare creates a private disabled draft/u);
  assert.match(CAMPAIGN_WORKSPACE_HTML, /Exact count required/u);
  assert.match(CAMPAIGN_WORKSPACE_HTML, /Browser setup required/u);
  assert.match(CAMPAIGN_WORKSPACE_HTML, /Open browser setup/u);
});

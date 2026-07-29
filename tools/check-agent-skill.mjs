#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repoRoot, "plugins", "dmfaster", "skills", "dmfaster");
const skillPath = path.join(skillRoot, "SKILL.md");
const agentPath = path.join(skillRoot, "agents", "openai.yaml");
const legacySkillRoot = path.join(repoRoot, "packages", "agent-skill");

function fail(message) {
  process.stderr.write(`DM Faster skill check failed: ${message}\n`);
  process.exitCode = 1;
}

function containsFiles(directory) {
  if (!existsSync(directory)) return false;
  return readdirSync(directory, { withFileTypes: true }).some((entry) => (
    entry.isFile()
    || entry.isSymbolicLink()
    || (entry.isDirectory() && containsFiles(path.join(directory, entry.name)))
  ));
}

if (containsFiles(legacySkillRoot)) {
  fail("legacy packages/agent-skill must not duplicate the canonical plugin skill");
}

if (!existsSync(skillPath)) {
  fail(`missing ${path.relative(repoRoot, skillPath)}`);
} else {
  const source = readFileSync(skillPath, "utf8");
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatter) {
    fail("SKILL.md must start with YAML frontmatter");
  } else {
    const keys = [...frontmatter[1].matchAll(/^([a-z][a-z0-9_-]*):/gm)].map((match) => match[1]);
    if (keys.join(",") !== "name,description") {
      fail("SKILL.md frontmatter must contain only name and description");
    }
    const name = frontmatter[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (name !== "dmfaster") fail('frontmatter name must be "dmfaster"');
    if (!description || description.length < 120 || description.length > 1_024) {
      fail("frontmatter description must be informative and at most 1,024 characters");
    }
  }

  if (/\bTODO\b|\[TODO/i.test(source)) fail("SKILL.md still contains template TODO text");
  if (!/browser cookies/i.test(source) || !/browser-worker tokens/i.test(source)) {
    fail("SKILL.md must preserve the public-authentication boundary");
  }
  if (!/generic HTTP/i.test(source) || !/database access/i.test(source)) {
    fail("SKILL.md must reject generic transport and database workarounds");
  }
  if (!/read-only/i.test(source)) fail("SKILL.md must state the current read-only boundary");
  if (!/references\/authentication\.md/.test(source)) {
    fail("SKILL.md must route authentication through its dedicated reference");
  }
  if (!/references\/tools\.md/.test(source)) {
    fail("SKILL.md must route tool selection through its dedicated reference");
  }

  const requiredTools = [
    "workspace_briefing",
    "campaigns_list",
    "campaign_inspect",
    "sending_inspect",
    "replies_list",
    "pipeline_inspect",
    "company_timeline",
  ];
  for (const tool of requiredTools) {
    if (!source.includes("`" + tool + "`")) fail(`SKILL.md is missing documented tool ${tool}`);
  }

  for (const match of source.matchAll(/\]\((references\/[^)]+)\)/g)) {
    const target = path.resolve(skillRoot, match[1]);
    if (!target.startsWith(`${skillRoot}${path.sep}`) || !existsSync(target)) {
      fail(`missing referenced resource ${match[1]}`);
    }
  }
}

if (!existsSync(agentPath)) {
  fail(`missing ${path.relative(repoRoot, agentPath)}`);
} else {
  const agentSource = readFileSync(agentPath, "utf8");
  if (!/^interface:\s*$/m.test(agentSource)) fail("agents/openai.yaml must define interface metadata");
  if (!/short_description:\s*"[^"]*read-only[^"]*"/i.test(agentSource)) {
    fail("agents/openai.yaml must describe the current read-only surface");
  }
  if (!/default_prompt:\s*"[^"]*\$dmfaster[^"]*"/.test(agentSource)) {
    fail("agents/openai.yaml default prompt must explicitly invoke $dmfaster");
  }
  if (!/^dependencies:\s*$[\s\S]*?type:\s*"mcp"$[\s\S]*?value:\s*"dmfaster"$[\s\S]*?transport:\s*"stdio"$/m.test(agentSource)) {
    fail("agents/openai.yaml must declare the dmfaster stdio MCP dependency");
  }
  if (/\bTODO\b|\[TODO/i.test(agentSource)) fail("agents/openai.yaml contains TODO text");
}

if (!process.exitCode) process.stdout.write("DM Faster skill structure is valid.\n");

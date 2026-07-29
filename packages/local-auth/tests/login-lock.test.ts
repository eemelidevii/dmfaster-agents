import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LOGIN_LOCK_STALE_AFTER_MS,
  LoginAlreadyInProgressError,
  acquireLoginLock,
} from "../src/index.ts";

const BASE_URL = "https://app.dmfaster.test";

async function temporaryLockRoot() {
  return mkdtemp(join(tmpdir(), "dmfaster-login-lock-"));
}

test("allows exactly one concurrent login per API origin", async () => {
  const rootDirectory = await temporaryLockRoot();
  try {
    const attempts = await Promise.allSettled([
      acquireLoginLock({
        baseUrl: BASE_URL,
        platform: "linux",
        rootDirectory,
        ownerId: "concurrent_owner_one",
        pid: 1001,
      }),
      acquireLoginLock({
        baseUrl: BASE_URL,
        platform: "linux",
        rootDirectory,
        ownerId: "concurrent_owner_two",
        pid: 1002,
      }),
    ]);

    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.status === "rejected");
    assert.ok(rejected[0].reason instanceof LoginAlreadyInProgressError);
    assert.match(rejected[0].reason.message, /already in progress.*retry/);
    if (fulfilled[0]?.status === "fulfilled") await fulfilled[0].value.release();
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("release removes only its owned lock and permits immediate reacquisition", async () => {
  const rootDirectory = await temporaryLockRoot();
  try {
    const first = await acquireLoginLock({
      baseUrl: BASE_URL,
      platform: "darwin",
      rootDirectory,
      ownerId: "release_owner_one",
      pid: 2001,
    });
    const entries = await readdir(rootDirectory);
    assert.equal(entries.length, 1);
    assert.doesNotMatch(entries[0] || "", /dmfaster|app|token|device/i);
    const metadataPath = join(rootDirectory, entries[0] || "", "owner.json");
    const metadata = await readFile(metadataPath, "utf8");
    assert.doesNotMatch(metadata, /dmf_pat_|dmf_device_|https:\/\//);
    assert.deepEqual(Object.keys(JSON.parse(metadata) as object).sort(), [
      "createdAt",
      "expiresAt",
      "ownerId",
      "pid",
      "version",
    ]);
    assert.equal((await stat(join(rootDirectory, entries[0] || ""))).mode & 0o077, 0);

    await first.release();
    const second = await acquireLoginLock({
      baseUrl: BASE_URL,
      platform: "darwin",
      rootDirectory,
      ownerId: "release_owner_two",
      pid: 2002,
    });
    await second.release();
    assert.deepEqual(await readdir(rootDirectory), []);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("recovers a stale lock after the authorization deadline without old-owner deletion", async () => {
  const rootDirectory = await temporaryLockRoot();
  let currentTime = 10_000;
  const now = () => currentTime;
  try {
    const oldLock = await acquireLoginLock({
      baseUrl: BASE_URL,
      platform: "linux",
      rootDirectory,
      ownerId: "stale_owner_old",
      pid: 3001,
      now,
    });

    currentTime += LOGIN_LOCK_STALE_AFTER_MS + 1;
    const replacement = await acquireLoginLock({
      baseUrl: BASE_URL,
      platform: "linux",
      rootDirectory,
      ownerId: "stale_owner_new",
      pid: 3002,
      now,
    });

    // A resumed old process must not remove the replacement's directory.
    await assert.rejects(oldLock.assertOwned(), /lock expired or was recovered/);
    await replacement.assertOwned();
    await oldLock.release();
    await assert.rejects(
      acquireLoginLock({
        baseUrl: BASE_URL,
        platform: "linux",
        rootDirectory,
        ownerId: "stale_owner_third",
        pid: 3003,
        now,
      }),
      LoginAlreadyInProgressError,
    );

    await replacement.release();
    const afterRelease = await acquireLoginLock({
      baseUrl: BASE_URL,
      platform: "linux",
      rootDirectory,
      ownerId: "stale_owner_final",
      pid: 3004,
      now,
    });
    await afterRelease.release();
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

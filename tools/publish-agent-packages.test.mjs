import assert from "node:assert/strict";
import test from "node:test";

import { extractPublishedReport, publishPackageSequence } from "./publish-agent-packages.mjs";

const definitions = [
  { directory: "first", name: "@dmfaster/first" },
  { directory: "second", name: "@dmfaster/second" },
];
const version = "1.2.3";

function artifact(definition) {
  return {
    name: definition.name,
    version,
    integrity: `sha512-${definition.directory}`,
    tarballPath: `/tmp/${definition.directory}.tgz`,
  };
}

test("release skips matching immutable packages and publishes only missing packages in order", () => {
  const events = [];
  publishPackageSequence({
    definitions,
    version,
    packPackage(definition) {
      events.push(`pack:${definition.directory}`);
      return artifact(definition);
    },
    getPublishedArtifact(definition) {
      events.push(`view:${definition.directory}`);
      return definition.directory === "first"
        ? { integrity: artifact(definition).integrity, provenance: true }
        : null;
    },
    publishPackage(definition, packed) {
      events.push(`publish:${definition.directory}`);
      return packed;
    },
    write() {},
  });

  assert.deepEqual(events, [
    "pack:first",
    "view:first",
    "pack:second",
    "view:second",
    "publish:second",
  ]);
});

test("release fails closed when an immutable version has different contents", () => {
  const published = [];
  assert.throws(
    () => publishPackageSequence({
      definitions,
      version,
      packPackage: artifact,
      getPublishedArtifact() {
        return { integrity: "sha512-unexpected", provenance: true };
      },
      publishPackage(definition) {
        published.push(definition.name);
      },
      write() {},
    }),
    /already exists with integrity/u,
  );
  assert.deepEqual(published, []);
});

test("release finds a later immutable conflict before publishing an earlier missing package", () => {
  const published = [];
  assert.throws(
    () => publishPackageSequence({
      definitions,
      version,
      packPackage: artifact,
      getPublishedArtifact(definition) {
        return definition.directory === "first"
          ? null
          : { integrity: "sha512-unexpected", provenance: true };
      },
      publishPackage(definition, packed) {
        published.push(definition.name);
        return packed;
      },
      write() {},
    }),
    /already exists with integrity/u,
  );
  assert.deepEqual(published, []);
});

test("release verifies the registry response against the exact packed artifact", () => {
  assert.throws(
    () => publishPackageSequence({
      definitions: [definitions[0]],
      version,
      packPackage: artifact,
      getPublishedArtifact() {
        return null;
      },
      publishPackage(definition, packed) {
        return { ...packed, integrity: "sha512-changed" };
      },
      write() {},
    }),
    /without the expected artifact integrity/u,
  );
});

test("release refuses an existing matching artifact without provenance", () => {
  const published = [];
  assert.throws(
    () => publishPackageSequence({
      definitions: [definitions[0]],
      version,
      packPackage: artifact,
      getPublishedArtifact(definition) {
        return { integrity: artifact(definition).integrity, provenance: false };
      },
      publishPackage(definition) {
        published.push(definition.name);
      },
      write() {},
    }),
    /without verified npm provenance metadata/u,
  );
  assert.deepEqual(published, []);
});

test("release rechecks current main after all preflight checks and before any publish", () => {
  const events = [];
  publishPackageSequence({
    definitions: [definitions[0]],
    version,
    packPackage(definition) {
      events.push("pack");
      return artifact(definition);
    },
    getPublishedArtifact() {
      events.push("view");
      return null;
    },
    beforePublish() {
      events.push("main");
    },
    publishPackage(definition, packed) {
      events.push("publish");
      return packed;
    },
    write() {},
  });
  assert.deepEqual(events, ["pack", "view", "main", "publish"]);
});

test("release accepts npm publish's package-keyed JSON response", () => {
  const report = artifact(definitions[0]);
  assert.deepEqual(extractPublishedReport({ [definitions[0].name]: report }, definitions[0].name), report);
  assert.deepEqual(extractPublishedReport(report, definitions[0].name), report);
});

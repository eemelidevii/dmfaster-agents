import { spawn } from "node:child_process";

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunProcess = (
  executable: string,
  args: readonly string[],
  options?: { stdin?: string },
) => Promise<ProcessResult>;

const MAX_OUTPUT_BYTES = 16 * 1024;

export const runProcess: RunProcess = (executable, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(executable, [...args], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;

  child.once("error", reject);
  child.stdout.on("data", (chunk: Buffer) => {
    if (stdoutBytes >= MAX_OUTPUT_BYTES) return;
    stdoutBytes += chunk.length;
    stdout.push(chunk.subarray(0, Math.max(0, MAX_OUTPUT_BYTES - stdoutBytes + chunk.length)));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderrBytes >= MAX_OUTPUT_BYTES) return;
    stderrBytes += chunk.length;
    stderr.push(chunk.subarray(0, Math.max(0, MAX_OUTPUT_BYTES - stderrBytes + chunk.length)));
  });
  child.once("close", (code) => {
    resolve({
      exitCode: code ?? 1,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
  });

  child.stdin.on("error", () => {
    // A command may close stdin early when it fails. Its exit code and captured
    // diagnostics are handled above without ever echoing the supplied secret.
  });
  child.stdin.end(options.stdin ?? "");
});

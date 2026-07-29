import type { RunProcess } from "./process.ts";
import { runProcess } from "./process.ts";

export type OpenBrowser = (url: string) => Promise<void>;

export function createBrowserOpener(input: {
  platform?: NodeJS.Platform;
  runProcess?: RunProcess;
} = {}): OpenBrowser {
  const platform = input.platform ?? process.platform;
  const run = input.runProcess ?? runProcess;

  return async (url) => {
    let executable: string;
    let args: string[];
    if (platform === "darwin") {
      executable = "/usr/bin/open";
      args = [url];
    } else if (platform === "linux") {
      executable = "xdg-open";
      args = [url];
    } else if (platform === "win32") {
      executable = "rundll32.exe";
      args = ["url.dll,FileProtocolHandler", url];
    } else {
      throw new Error(`Opening a browser is not supported on ${platform}. Open the displayed URL manually.`);
    }

    let result;
    try {
      result = await run(executable, args);
    } catch (cause) {
      throw new Error("Could not open the browser. Open the displayed URL manually.", { cause });
    }
    if (result.exitCode !== 0) {
      throw new Error("Could not open the browser. Open the displayed URL manually.");
    }
  };
}

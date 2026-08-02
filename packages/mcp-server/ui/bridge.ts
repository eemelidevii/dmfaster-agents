export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

type JsonObject = Record<string, unknown>;
type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: number;
};

export type HostContext = {
  theme?: "light" | "dark";
  displayMode?: string;
  availableDisplayModes?: string[];
  styles?: { variables?: Record<string, string> };
};

export type HostCapabilities = {
  serverTools?: unknown;
  openLinks?: unknown;
  message?: unknown;
  updateModelContext?: unknown;
};

type OpenAiCompatibility = {
  toolInput?: unknown;
  callTool?: (name: string, input: unknown) => Promise<unknown>;
  setWidgetState?: (value: unknown) => Promise<void>;
  openExternal?: (value: { href: string }) => void;
};

declare global {
  interface Window {
    openai?: OpenAiCompatibility;
  }
}

export type BridgeNotification = {
  method: string;
  params?: JsonObject;
};

export class McpAppBridge {
  #nextRequestId = 0;
  #pending = new Map<number, PendingRequest>();
  #listeners = new Set<(notification: BridgeNotification) => void>();
  standard = false;
  capabilities: HostCapabilities = {};
  context: HostContext = {};

  constructor() {
    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data as JsonObject | null;
      if (!message || message.jsonrpc !== "2.0") return;
      const id = typeof message.id === "number" ? message.id : null;
      if (id !== null && typeof message.method !== "string") {
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        window.clearTimeout(pending.timer);
        const error = message.error as JsonObject | undefined;
        if (error) pending.reject(new Error(String(error.message || "The MCP host returned an error.")));
        else pending.resolve(message.result);
        return;
      }
      if (typeof message.method === "string") {
        const notification = {
          method: message.method,
          params: message.params && typeof message.params === "object" ? message.params as JsonObject : undefined,
        };
        this.#listeners.forEach((listener) => listener(notification));
      }
    });
  }

  subscribe(listener: (notification: BridgeNotification) => void) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  post(message: JsonObject) {
    window.parent.postMessage(message, "*");
  }

  notify(method: string, params: JsonObject = {}) {
    this.post({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: JsonObject = {}, timeoutMs = 30_000) {
    this.#nextRequestId += 1;
    const id = this.#nextRequestId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`The MCP host did not answer ${method}.`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.post({ jsonrpc: "2.0", id, method, params });
    });
  }

  async initialize() {
    try {
      const initialized = await this.request("ui/initialize", {
        appInfo: { name: "DM Faster campaign workspace", version: "1.0.0" },
        appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
        protocolVersion: MCP_APP_PROTOCOL_VERSION,
      }, 4_000) as {
        hostCapabilities?: HostCapabilities;
        hostContext?: HostContext;
      };
      this.standard = true;
      this.capabilities = initialized.hostCapabilities || {};
      this.context = initialized.hostContext || {};
      this.applyHostContext(this.context);
      this.notify("ui/notifications/initialized");
      return { mode: "standard" as const, input: null };
    } catch {
      if (window.openai && (window.openai.toolInput || window.openai.callTool)) {
        this.standard = false;
        return { mode: "openai" as const, input: window.openai.toolInput || null };
      }
      return { mode: "headless" as const, input: null };
    }
  }

  applyHostContext(context: HostContext) {
    this.context = { ...this.context, ...context };
    const variables = this.context.styles?.variables;
    if (variables) {
      Object.entries(variables).forEach(([name, value]) => {
        if (typeof value === "string") document.documentElement.style.setProperty(name, value);
      });
    }
  }

  canCallTools() {
    return this.standard ? Boolean(this.capabilities.serverTools) : Boolean(window.openai?.callTool);
  }

  async callTool(name: string, input: unknown) {
    if (this.standard) return this.request("tools/call", { name, arguments: input }, 60_000);
    if (window.openai?.callTool) return window.openai.callTool(name, input);
    throw new Error("This host does not expose app-initiated MCP tool calls.");
  }

  async updateModelContext(content: unknown) {
    if (this.standard && this.capabilities.updateModelContext) {
      return this.request("ui/update-model-context", content as JsonObject);
    }
    if (window.openai?.setWidgetState) return window.openai.setWidgetState(content);
    if (this.standard && this.capabilities.message) {
      const record = asJsonObject(content);
      const summary = Array.isArray(record.content)
        ? record.content.map((part) => String(asJsonObject(part).text || "")).filter(Boolean).join("\n")
        : "The user updated the DM Faster campaign workspace.";
      return this.request("ui/message", {
        role: "user",
        content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(record.structuredContent || {})}` }],
      });
    }
    throw new Error("This host cannot add the edited campaign state back to model context.");
  }

  async openLink(url: string) {
    if (this.standard && this.capabilities.openLinks) return this.request("ui/open-link", { url });
    if (window.openai?.openExternal) return window.openai.openExternal({ href: url });
    throw new Error("This host cannot open the approval page.");
  }

  async toggleDisplayMode() {
    if (!this.standard) return;
    const nextMode = this.context.displayMode === "fullscreen" ? "inline" : "fullscreen";
    const result = await this.request("ui/request-display-mode", { mode: nextMode }) as { mode?: string };
    if (result.mode) this.context = { ...this.context, displayMode: result.mode };
  }

  reportSize() {
    if (!this.standard) return;
    this.notify("ui/notifications/size-changed", {
      width: Math.ceil(document.documentElement.getBoundingClientRect().width),
      height: Math.ceil(document.documentElement.getBoundingClientRect().height),
    });
  }
}

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? value as JsonObject : {};
}

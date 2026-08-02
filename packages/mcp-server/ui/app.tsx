import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { AgentCampaignState } from "@dmfaster/sdk";
import {
  CampaignToggle,
  PageIntro,
  Panel,
  TonePill,
  inputClass,
  numberInputClass,
  primaryButtonClass,
  subtleButtonClass,
  textareaClass,
} from "@dmfaster/product-ui";
import {
  AnalyticsLineChartCard,
  AnalyticsMetricCard,
  type AnalyticsChartDatum,
  type AnalyticsChartSeries,
} from "@dmfaster/product-ui/analytics";

import { McpAppBridge, type BridgeNotification } from "./bridge.ts";

type WorkspaceInput = {
  state: AgentCampaignState;
  campaignId?: string | null;
};

type TabId = "audience" | "messages" | "delivery" | "business";
type CampaignChannel = AgentCampaignState["brief"]["requestedChannels"][number];
type ToolAction = "validate" | "preview" | "prepare" | "preflight";
type PreviewCompany = {
  name?: string;
  city?: string;
  country?: string;
  industry?: string;
  website?: string;
  domain?: string;
};
type ToolView = {
  tool: string;
  summary: string;
  failed: boolean;
  blockers: string[];
  companies: PreviewCompany[];
  setupUrl: string;
  setupState: string;
  approvalUrl: string;
  confirmationCode: string;
  raw: unknown;
};

const bridge = new McpAppBridge();
const channels: Array<{ id: CampaignChannel; label: string; color: string }> = [
  { id: "instagram", label: "Instagram", color: "text-rose-500" },
  { id: "facebook", label: "Facebook", color: "text-blue-600" },
  { id: "linkedin", label: "LinkedIn", color: "text-[#0a66c2]" },
  { id: "gmail", label: "Email", color: "text-rose-600" },
];
const weekdays = [
  { bit: 1, short: "Mon" },
  { bit: 2, short: "Tue" },
  { bit: 4, short: "Wed" },
  { bit: 8, short: "Thu" },
  { bit: 16, short: "Fri" },
  { bit: 32, short: "Sat" },
  { bit: 64, short: "Sun" },
];
const tabs: Array<{ id: TabId; label: string; description: string }> = [
  { id: "audience", label: "Audience", description: "Targeting intent and executable lead filters." },
  { id: "messages", label: "Messages", description: "Channel copy, language, and voice." },
  { id: "delivery", label: "Delivery", description: "Channels, schedule, and conservative limits." },
  { id: "business", label: "Business", description: "Offer, proof, and business context." },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function cloneState(state: AgentCampaignState) {
  return structuredClone(state);
}

function csv(value: string) {
  return Array.from(new Set(value.split(",").map((part) => part.trim()).filter(Boolean)));
}

function formatNumber(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("en-US").format(value);
}

function newKey(prefix: string) {
  const random = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `mcp-app:${prefix}:${random}`;
}

function toolPayload(result: unknown) {
  const record = asRecord(result);
  return asRecord(record?.structuredContent) || record || {};
}

function harnessFrom(payload: Record<string, unknown>) {
  const data = asRecord(payload.data);
  return data?.version === 1 && typeof data.summary === "string" ? data : null;
}

function workspaceInput(value: unknown): WorkspaceInput | null {
  const record = asRecord(value);
  const state = asRecord(record?.state);
  if (!state || !asRecord(state.profile) || !asRecord(state.brief)) return null;
  return {
    state: structuredClone(state) as AgentCampaignState,
    campaignId: typeof record?.campaignId === "string" ? record.campaignId : null,
  };
}

function companyInitials(name: string) {
  return name.split(/\s+/u).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "—";
}

function dayBit(date: Date) {
  return [64, 1, 2, 4, 8, 16, 32][date.getDay()] || 1;
}

function deliveryForecast(state: AgentCampaignState, exactAudience: number | null) {
  const cap = Math.max(0, Number(state.brief.deliverySettings.dailyCap || 0));
  let remaining = exactAudience;
  const today = new Date();
  const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const full = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const data: AnalyticsChartDatum[] = Array.from({ length: 21 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    const allowed = Boolean(state.brief.deliverySettings.weekdays & dayBit(date));
    const planned = allowed && cap > 0
      ? remaining === null ? cap : Math.min(cap, Math.max(0, remaining))
      : 0;
    if (remaining !== null) remaining = Math.max(0, remaining - planned);
    return {
      id: date.toISOString().slice(0, 10),
      label: short.format(date),
      fullLabel: full.format(date),
      values: [planned],
    };
  });

  let calendarDays: number | null = null;
  if (exactAudience !== null && cap > 0) {
    let simulatedRemaining = exactAudience;
    for (let index = 0; index < 3_650 && simulatedRemaining > 0; index += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() + index);
      if (state.brief.deliverySettings.weekdays & dayBit(date)) simulatedRemaining -= cap;
      if (simulatedRemaining <= 0) calendarDays = index + 1;
    }
  }

  return { data, calendarDays };
}

function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 text-sm font-semibold text-slate-800 ${className}`}>
      <span>{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}

function Tags({ values, empty }: { values: string[]; empty: string }) {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
      {values.length ? values.map((value) => (
        <span key={value} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
          {value}
        </span>
      )) : <span className="text-xs text-slate-400">{empty}</span>}
    </div>
  );
}

function ChannelIcon({ channel }: { channel: CampaignChannel }) {
  if (channel === "instagram") {
    return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" /><circle cx="16.2" cy="7.8" r="1" fill="currentColor" /></svg>;
  }
  if (channel === "facebook") {
    return <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor" /><path d="M13.25 18v-5.2h1.75l.32-2.05h-2.07V9.42c0-.58.18-.98 1-.98h1.14V6.6c-.55-.08-1.1-.12-1.66-.12-1.65 0-2.78 1.02-2.78 2.86v1.41H9.08v2.05h1.87V18h2.3Z" fill="white" /></svg>;
  }
  if (channel === "linkedin") {
    return <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3.2" fill="currentColor" /><path d="M8.15 10.25h2.1v6.1h-2.1v-6.1Zm1.05-2.9a1.18 1.18 0 1 1 0 2.36 1.18 1.18 0 0 1 0-2.36Zm2.35 2.9h2v.82c.32-.5.95-.98 1.98-.98 2.05 0 2.47 1.35 2.47 3.1v3.16h-2.1v-2.8c0-.65-.02-1.48-.9-1.48-.9 0-1.05.7-1.05 1.43v2.85h-2.4v-6.1Z" fill="white" /></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true"><path d="M4 7.5h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9Z" stroke="currentColor" strokeWidth="1.8" /><path d="m5 8 7 5 7-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}

function AudienceEditor({
  state,
  update,
}: {
  state: AgentCampaignState;
  update: (mutator: (next: AgentCampaignState) => void, invalidateAudience?: boolean) => void;
}) {
  const resolution = state.brief.industryResolution;
  const industryTags = [
    ...(resolution?.resolvedLabel ? [resolution.resolvedLabel] : []),
    ...state.brief.industryCodes.map((code) => `TOL ${code}`),
  ];
  const signalTags = state.brief.requestedSignals.map((signal) => `${signal.key.replaceAll("_", " ")} · ${signal.required ? "required" : "optional"}`);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Campaign objective" className="sm:col-span-2">
        <input className={inputClass} value={state.brief.objective} onChange={(event) => update((next) => { next.brief.objective = event.target.value; })} />
      </Field>
      <Field label="Target companies" className="sm:col-span-2" hint="Describe the audience naturally; the resolved filters below remain authoritative.">
        <textarea className={`${textareaClass} min-h-28`} value={state.brief.targetDescription} onChange={(event) => update((next) => { next.brief.targetDescription = event.target.value; }, true)} />
      </Field>
      <Field label="Countries">
        <input className={inputClass} value={state.brief.countries.join(", ")} onChange={(event) => update((next) => { next.brief.countries = csv(event.target.value).map((value) => value.toUpperCase()) as typeof next.brief.countries; }, true)} />
      </Field>
      <Field label="Cities">
        <input className={inputClass} value={(state.brief.cities || []).join(", ")} onChange={(event) => update((next) => { next.brief.cities = csv(event.target.value); }, true)} />
      </Field>
      <Field label="Decision-maker roles" className="sm:col-span-2">
        <input className={inputClass} value={state.brief.decisionMakerRoles.join(", ")} onChange={(event) => update((next) => { next.brief.decisionMakerRoles = csv(event.target.value); }, true)} />
      </Field>
      <Field label="Employees minimum">
        <input className={numberInputClass} type="number" min="0" value={state.brief.companySize.employeeMin ?? ""} onChange={(event) => update((next) => { next.brief.companySize.employeeMin = event.target.value ? Number(event.target.value) : null; }, true)} />
      </Field>
      <Field label="Employees maximum">
        <input className={numberInputClass} type="number" min="0" value={state.brief.companySize.employeeMax ?? ""} onChange={(event) => update((next) => { next.brief.companySize.employeeMax = event.target.value ? Number(event.target.value) : null; }, true)} />
      </Field>
      <Field label="Revenue minimum, EUR">
        <input className={numberInputClass} type="number" min="0" value={state.brief.companySize.revenueMinEur ?? ""} onChange={(event) => update((next) => { next.brief.companySize.revenueMinEur = event.target.value ? Number(event.target.value) : null; }, true)} />
      </Field>
      <Field label="Revenue maximum, EUR">
        <input className={numberInputClass} type="number" min="0" value={state.brief.companySize.revenueMaxEur ?? ""} onChange={(event) => update((next) => { next.brief.companySize.revenueMaxEur = event.target.value ? Number(event.target.value) : null; }, true)} />
      </Field>
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Resolved industries</p>
        <Tags values={industryTags} empty="No industry has been resolved yet" />
      </div>
      <Field label="Company exclusions" className="sm:col-span-2">
        <input className={inputClass} value={state.brief.exclusions.join(", ")} onChange={(event) => update((next) => { next.brief.exclusions = csv(event.target.value); }, true)} />
      </Field>
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-sm font-semibold text-slate-800">Signals and ad evidence</p>
        <Tags values={signalTags} empty="No signal filter requested" />
      </div>
      <Field label="Call to action" className="sm:col-span-2">
        <input className={inputClass} value={state.brief.callToAction} onChange={(event) => update((next) => { next.brief.callToAction = event.target.value; })} />
      </Field>
    </div>
  );
}

function MessageEditor({
  state,
  update,
}: {
  state: AgentCampaignState;
  update: (mutator: (next: AgentCampaignState) => void) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Message language">
          <input className={inputClass} value={state.brief.messageLanguage} onChange={(event) => update((next) => { next.brief.messageLanguage = event.target.value; })} />
        </Field>
        <Field label="Tone">
          <input className={inputClass} value={state.brief.tone} onChange={(event) => update((next) => { next.brief.tone = event.target.value; next.profile.preferredTone = event.target.value; })} />
        </Field>
      </div>

      <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
        {state.brief.outreachMessages.map((message, messageIndex) => (
          <div key={messageIndex} className="space-y-3 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-950">Message {messageIndex + 1}</p>
                <p className="mt-0.5 text-xs text-slate-500">{message.origin === "user" ? "Edited by you" : "Agent draft"}</p>
              </div>
              <button
                type="button"
                className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-40"
                disabled={state.brief.outreachMessages.length <= 1}
                onClick={() => update((next) => { next.brief.outreachMessages.splice(messageIndex, 1); })}
              >
                Remove
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {channels.map((channel) => {
                const selected = message.channels.includes(channel.id);
                return (
                  <button
                    key={channel.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => update((next) => {
                      const target = next.brief.outreachMessages[messageIndex];
                      if (!target) return;
                      target.channels = selected
                        ? target.channels.filter((value) => value !== channel.id)
                        : Array.from(new Set([...target.channels, channel.id]));
                      target.origin = "user";
                    })}
                    className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition ${
                      selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <span className={selected ? "text-white" : channel.color}><ChannelIcon channel={channel.id} /></span>
                    {channel.label}
                  </button>
                );
              })}
            </div>
            <Field label="Subject (email only)">
              <input className={inputClass} value={message.subject || ""} onChange={(event) => update((next) => {
                const target = next.brief.outreachMessages[messageIndex];
                if (target) { target.subject = event.target.value; target.origin = "user"; }
              })} />
            </Field>
            <Field label="Message body">
              <textarea className={`${textareaClass} min-h-32`} value={message.body} onChange={(event) => update((next) => {
                const target = next.brief.outreachMessages[messageIndex];
                if (target) { target.body = event.target.value; target.origin = "user"; }
              })} />
            </Field>
          </div>
        ))}
      </div>
      <button
        type="button"
        className={subtleButtonClass}
        onClick={() => update((next) => {
          next.brief.outreachMessages.push({
            channels: next.brief.requestedChannels.length ? [...next.brief.requestedChannels] : ["instagram"],
            subject: "",
            body: "",
            origin: "user",
          });
        })}
      >
        Add message
      </button>
    </div>
  );
}

function DeliveryEditor({
  state,
  update,
}: {
  state: AgentCampaignState;
  update: (mutator: (next: AgentCampaignState) => void) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-slate-800">Requested channels</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {channels.map((channel) => {
            const selected = state.brief.requestedChannels.includes(channel.id);
            return (
              <div key={channel.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3">
                <span className={`inline-flex items-center gap-2 text-sm font-semibold text-slate-800 ${channel.color}`}>
                  <ChannelIcon channel={channel.id} />
                  <span className="text-slate-800">{channel.label}</span>
                </span>
                <CampaignToggle
                  checked={selected}
                  ariaLabel={`${selected ? "Disable" : "Enable"} ${channel.label}`}
                  onChange={(checked) => update((next) => {
                    next.brief.requestedChannels = checked
                      ? Array.from(new Set([...next.brief.requestedChannels, channel.id]))
                      : next.brief.requestedChannels.filter((value) => value !== channel.id);
                  })}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Daily company limit">
          <input className={numberInputClass} type="number" min="1" value={state.brief.deliverySettings.dailyCap ?? ""} onChange={(event) => update((next) => {
            const value = event.target.value ? Number(event.target.value) : null;
            next.brief.deliverySettings.dailyCap = value;
            next.brief.dailyVolume = value;
          })} />
        </Field>
        <Field label="Timezone">
          <input className={inputClass} value={state.brief.deliverySettings.timezone} onChange={(event) => update((next) => { next.brief.deliverySettings.timezone = event.target.value; })} />
        </Field>
        <Field label="Window starts">
          <input className={inputClass} type="time" value={state.brief.deliverySettings.windowStart} onChange={(event) => update((next) => { next.brief.deliverySettings.windowStart = event.target.value; })} />
        </Field>
        <Field label="Window ends">
          <input className={inputClass} type="time" value={state.brief.deliverySettings.windowEnd} onChange={(event) => update((next) => { next.brief.deliverySettings.windowEnd = event.target.value; })} />
        </Field>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-800">Sending days</p>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {weekdays.map((weekday) => {
            const selected = Boolean(state.brief.deliverySettings.weekdays & weekday.bit);
            return (
              <button
                key={weekday.bit}
                type="button"
                aria-pressed={selected}
                onClick={() => update((next) => {
                  const updated = selected
                    ? next.brief.deliverySettings.weekdays & ~weekday.bit
                    : next.brief.deliverySettings.weekdays | weekday.bit;
                  if (updated) next.brief.deliverySettings.weekdays = updated;
                })}
                className={`h-10 rounded-lg border text-xs font-bold transition ${selected ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
              >
                {weekday.short}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3">
        <div>
          <p className="text-sm font-bold text-emerald-900">Delivery settings confirmed</p>
          <p className="mt-0.5 text-xs text-emerald-700">Required before a private draft can be prepared.</p>
        </div>
        <CampaignToggle checked={state.brief.deliverySettings.confirmed} onChange={(checked) => update((next) => { next.brief.deliverySettings.confirmed = checked; })} />
      </div>
    </div>
  );
}

function BusinessEditor({
  state,
  update,
}: {
  state: AgentCampaignState;
  update: (mutator: (next: AgentCampaignState) => void) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Business name">
        <input className={inputClass} value={state.profile.businessName} onChange={(event) => update((next) => { next.profile.businessName = event.target.value; })} />
      </Field>
      <Field label="Website">
        <input className={inputClass} inputMode="url" value={state.profile.websiteUrl} onChange={(event) => update((next) => { next.profile.websiteUrl = event.target.value; })} />
      </Field>
      <Field label="Offer" className="sm:col-span-2">
        <textarea className={`${textareaClass} min-h-28`} value={state.brief.offer} onChange={(event) => update((next) => { next.brief.offer = event.target.value; next.profile.offer = event.target.value; })} />
      </Field>
      <Field label="Customer outcome" className="sm:col-span-2">
        <textarea className={`${textareaClass} min-h-28`} value={state.profile.customerOutcome} onChange={(event) => update((next) => { next.profile.customerOutcome = event.target.value; })} />
      </Field>
      <Field label="Business context" className="sm:col-span-2">
        <textarea className={`${textareaClass} min-h-32`} value={state.profile.businessDescription} onChange={(event) => update((next) => { next.profile.businessDescription = event.target.value; })} />
      </Field>
      <Field label="Differentiators" className="sm:col-span-2">
        <input className={inputClass} value={state.profile.differentiators.join(", ")} onChange={(event) => update((next) => { next.profile.differentiators = csv(event.target.value); })} />
      </Field>
      <Field label="Proof points" className="sm:col-span-2">
        <input className={inputClass} value={state.profile.proofPoints.join(", ")} onChange={(event) => update((next) => { next.profile.proofPoints = csv(event.target.value); })} />
      </Field>
      <Field label="Preferred languages">
        <input className={inputClass} value={state.profile.preferredLanguages.join(", ")} onChange={(event) => update((next) => { next.profile.preferredLanguages = csv(event.target.value); })} />
      </Field>
      <Field label="Default excluded traits">
        <input className={inputClass} value={state.profile.excludedCompanyTraits.join(", ")} onChange={(event) => update((next) => { next.profile.excludedCompanyTraits = csv(event.target.value); })} />
      </Field>
    </div>
  );
}

function CompanyPreview({ companies }: { companies: PreviewCompany[] }) {
  if (!companies.length) return null;
  return (
    <Panel title="Example companies" description={`${companies.length} shown from the exact audience preview.`} contentClassName="p-0">
      <div className="hidden min-h-9 grid-cols-[minmax(220px,1.4fr)_minmax(120px,.7fr)_minmax(150px,1fr)] items-center gap-4 border-b border-slate-200 bg-slate-50 px-4 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 md:grid">
        <span className="pl-11">Company</span><span>Location</span><span>Industry</span>
      </div>
      <div className="divide-y divide-slate-200">
        {companies.map((company, index) => {
          const name = company.name || "Unnamed company";
          return (
            <div key={`${name}-${index}`} className="grid min-h-16 items-center gap-3 px-4 py-3 md:grid-cols-[minmax(220px,1.4fr)_minmax(120px,.7fr)_minmax(150px,1fr)] md:gap-4">
              <div className="grid min-w-0 grid-cols-[34px_minmax(0,1fr)] items-center gap-3">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500">{companyInitials(name)}</span>
                <span className="min-w-0"><strong className="block truncate text-xs text-slate-950">{name}</strong><span className="mt-0.5 block truncate text-[10px] text-slate-400">{company.website || company.domain || "Company preview"}</span></span>
              </div>
              <span className="truncate text-xs text-slate-500">{[company.city, company.country].filter(Boolean).join(", ") || "—"}</span>
              <span className="truncate text-xs text-slate-500">{company.industry || "—"}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function App() {
  const [state, setState] = useState<AgentCampaignState | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [connection, setConnection] = useState<"connecting" | "connected" | "compatibility" | "headless">("connecting");
  const [activeTab, setActiveTab] = useState<TabId>("audience");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<ToolAction | "sync" | null>(null);
  const [exactAudience, setExactAudience] = useState<number | null>(null);
  const [result, setResult] = useState<ToolView | null>(null);
  const draftKey = useRef<string | null>(null);
  const launchKey = useRef<string | null>(null);
  const launchKeyCampaignId = useRef<string | null>(null);

  const load = useCallback((inputValue: unknown) => {
    const input = workspaceInput(inputValue);
    if (!input) return;
    setState(input.state);
    setCampaignId(input.campaignId || null);
    setDirty(false);
    setExactAudience(null);
    setResult(null);
    draftKey.current = null;
    launchKey.current = null;
    launchKeyCampaignId.current = null;
  }, []);

  useEffect(() => {
    const handleNotification = (notification: BridgeNotification) => {
      if (notification.method === "ui/notifications/tool-input") load(notification.params?.arguments);
      if (notification.method === "ui/notifications/tool-result") {
        const payload = toolPayload(notification.params);
        if (payload.view === "dmfaster.campaign_workspace" && payload.state) load(payload);
      }
      if (notification.method === "ui/notifications/host-context-changed") bridge.applyHostContext(notification.params || {});
    };
    const unsubscribe = bridge.subscribe(handleNotification);
    void bridge.initialize().then((initialized) => {
      if (initialized.mode === "standard") setConnection("connected");
      if (initialized.mode === "openai") {
        setConnection("compatibility");
        load(initialized.input);
      }
      if (initialized.mode === "headless") setConnection("headless");
    });
    return unsubscribe;
  }, [load]);

  useEffect(() => {
    if (typeof ResizeObserver !== "function") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => bridge.reportSize());
    });
    observer.observe(document.body);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  const update = useCallback((mutator: (next: AgentCampaignState) => void, invalidateAudience = false) => {
    setState((current) => {
      if (!current) return current;
      const next = cloneState(current);
      mutator(next);
      return next;
    });
    setDirty(true);
    draftKey.current = null;
    if (invalidateAudience) setExactAudience(null);
  }, []);

  const forecast = useMemo(() => state ? deliveryForecast(state, exactAudience) : null, [exactAudience, state]);
  const forecastSeries: AnalyticsChartSeries[] = [{
    label: exactAudience === null ? "Daily capacity" : "Planned messages",
    color: "#2c78ff",
    areaColor: "#2c78ff",
    width: 3,
  }];
  const canCall = connection !== "headless" && connection !== "connecting" && bridge.canCallTools();
  const activeTabCopy = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  const consumeResult = useCallback((toolName: string, toolResult: unknown) => {
    const payload = toolPayload(toolResult);
    const harness = harnessFrom(payload);
    const status = typeof harness?.status === "string" ? harness.status : "";
    const failed = Boolean(asRecord(toolResult)?.isError) || payload.ok === false || ["blocked", "failed", "needs_input"].includes(status);
    const error = asRecord(payload.error);
    const data = asRecord(payload.data);
    const harnessData = asRecord(harness?.data);
    const audience = asRecord(harnessData?.audience);
    const companies = Array.isArray(audience?.companies) ? audience.companies.filter((company) => asRecord(company)).map((company) => company as PreviewCompany) : [];
    if (audience?.totalMatchesExact === true && typeof audience.totalMatches === "number") setExactAudience(audience.totalMatches);
    else if (toolName === "audience_preview") setExactAudience(null);

    const refs = asRecord(harness?.resourceRefs);
    if (typeof refs?.campaignId === "string") {
      setCampaignId(refs.campaignId);
      launchKey.current = null;
      launchKeyCampaignId.current = null;
    }
    const authorization = asRecord(data?.authorization);
    const setup = asRecord(data?.setup);
    const setupUrl = toolName === "campaign_launch_preflight" && typeof setup?.setupUrl === "string" ? setup.setupUrl : "";
    const approvalUrl = toolName === "campaign_launch_preflight" && typeof data?.approvalUrl === "string" ? data.approvalUrl : "";
    const summary = typeof harness?.summary === "string"
      ? harness.summary
      : typeof error?.message === "string"
        ? error.message
        : setupUrl && typeof setup?.message === "string"
          ? setup.message
        : approvalUrl
          ? "Launch review is ready. The workspace owner must approve this exact campaign version in DM Faster."
          : failed ? "The operation could not be completed." : "The operation completed.";
    const blockers = Array.isArray(harness?.blockers)
      ? harness.blockers.map((blocker) => {
          const record = asRecord(blocker);
          return String(record?.message || record?.code || "Campaign requirement is not satisfied.");
        })
      : [];
    setResult({
      tool: toolName,
      summary,
      failed,
      blockers,
      companies,
      setupUrl,
      setupState: typeof setup?.state === "string" ? setup.state : "",
      approvalUrl,
      confirmationCode: typeof authorization?.confirmationCode === "string" ? authorization.confirmationCode : "",
      raw: payload,
    });
  }, []);

  const runAction = useCallback(async (action: ToolAction) => {
    if (!state || busy) return;
    setBusy(action);
    try {
      let toolName = "campaign_validate";
      let input: Record<string, unknown> = { state };
      if (action === "preview") { toolName = "audience_preview"; input = { state, sampleSize: 10 }; }
      if (action === "prepare") {
        toolName = "campaign_prepare";
        draftKey.current ||= newKey("prepare");
        input = { state, sampleSize: 10, idempotencyKey: draftKey.current };
      }
      if (action === "preflight") {
        if (!campaignId) throw new Error("Prepare a private campaign draft before requesting launch approval.");
        toolName = "campaign_launch_preflight";
        if (!launchKey.current || launchKeyCampaignId.current !== campaignId) {
          launchKey.current = newKey("launch");
          launchKeyCampaignId.current = campaignId;
        }
        input = { campaignId, idempotencyKey: launchKey.current };
      }
      const toolResult = await bridge.callTool(toolName, input);
      consumeResult(toolName, toolResult);
    } catch (error) {
      setResult({
        tool: "Host error",
        summary: error instanceof Error ? error.message : String(error),
        failed: true,
        blockers: [],
        companies: [],
        setupUrl: "",
        setupState: "",
        approvalUrl: "",
        confirmationCode: "",
        raw: { error: { message: error instanceof Error ? error.message : String(error) } },
      });
    } finally {
      setBusy(null);
    }
  }, [busy, campaignId, consumeResult, state]);

  const sync = useCallback(async () => {
    if (!state || busy) return;
    setBusy("sync");
    try {
      const summary = `The user updated the DM Faster campaign workspace for ${state.profile.businessName || "their business"}.`;
      await bridge.updateModelContext({
        content: [{ type: "text", text: `${summary} Treat the attached structured campaign state as the latest user-confirmed version.` }],
        structuredContent: { type: "dmfaster.campaign_state_update", state, campaignId },
      });
      setDirty(false);
    } catch (error) {
      setResult({
        tool: "Host error",
        summary: error instanceof Error ? error.message : String(error),
        failed: true,
        blockers: [],
        companies: [],
        setupUrl: "",
        setupState: "",
        approvalUrl: "",
        confirmationCode: "",
        raw: { error: { message: error instanceof Error ? error.message : String(error) } },
      });
    } finally {
      setBusy(null);
    }
  }, [busy, campaignId, state]);

  if (!state) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950">
        <div className="mx-auto max-w-xl">
          <Panel title="Loading campaign workspace" description={connection === "headless" ? "This host received the structured campaign state but does not render MCP Apps." : "Waiting for the stateless campaign state from the MCP host."}>
            <div className="flex items-center gap-3 text-sm text-slate-500"><span className="h-2 w-2 animate-pulse rounded-full bg-highlight" />DM Faster Campaign Assistant</div>
          </Panel>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto max-w-[1180px] space-y-3 px-3 py-4 sm:px-5 lg:px-6">
        <PageIntro
          eyebrow="DM Faster · Agent workspace"
          title={state.profile.businessName || "Campaign workspace"}
          body={state.brief.objective || "Review the complete campaign plan, preview the exact audience, and prepare a private draft."}
          actions={(
            <>
              <TonePill tone={connection === "connected" || connection === "compatibility" ? "green" : "slate"}>
                {connection === "connected" || connection === "compatibility" ? "Campaign assistant" : connection === "headless" ? "Headless host" : "Connecting"}
              </TonePill>
              <TonePill tone={dirty ? "amber" : "green"}>{dirty ? "Unsynced edits" : "State synced"}</TonePill>
              {bridge.context.availableDisplayModes?.includes("fullscreen") ? (
                <button type="button" className={subtleButtonClass} onClick={() => void bridge.toggleDisplayMode()}>Expand</button>
              ) : null}
            </>
          )}
        />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Campaign plan summary">
          <AnalyticsMetricCard
            label="Exact audience"
            value={exactAudience === null ? "—" : formatNumber(exactAudience)}
            detail={exactAudience === null ? "Exact count required" : "Authoritative company total"}
            accent="bg-highlight"
          />
          <AnalyticsMetricCard
            label="Estimated duration"
            value={forecast?.calendarDays === null ? "—" : `${forecast?.calendarDays || 0} days`}
            detail={exactAudience === null ? "Preview the audience to calculate" : "At the confirmed schedule"}
            accent="bg-slate-950"
          />
          <AnalyticsMetricCard
            label="Daily company limit"
            value={formatNumber(state.brief.deliverySettings.dailyCap)}
            detail={`${state.brief.deliverySettings.windowStart}–${state.brief.deliverySettings.windowEnd} · ${state.brief.deliverySettings.timezone}`}
            accent="bg-amber-400"
          />
          <AnalyticsMetricCard
            label="Channels"
            value={String(state.brief.requestedChannels.length)}
            detail={state.brief.requestedChannels.length ? state.brief.requestedChannels.join(", ") : "No channel selected"}
            accent="bg-emerald-500"
          />
        </section>

        <AnalyticsLineChartCard
          title="Projected outreach cadence"
          description="Daily planned messages under the selected sending window and weekday limits."
          data={forecast?.data || []}
          series={forecastSeries}
          emptyLabel="Set a daily limit and at least one sending day to build the forecast."
          note={exactAudience === null
            ? "This is capacity, not an audience estimate. Preview the exact audience before preparing a draft."
            : `The forecast uses the exact ${formatNumber(exactAudience)}-company audience and stops when that audience is exhausted.`}
          formatValue={(value) => formatNumber(value)}
          formatCompactValue={(value) => formatNumber(value)}
        />

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.75fr)] xl:items-start">
          <div className="space-y-3">
            <div className="grid grid-cols-4 items-center rounded-xl border border-slate-200 bg-white p-1" aria-label="Campaign editor sections">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`h-10 rounded-lg px-2 text-xs font-bold transition ${activeTab === tab.id ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <Panel title={activeTabCopy.label} description={activeTabCopy.description}>
              {activeTab === "audience" ? <AudienceEditor state={state} update={update} /> : null}
              {activeTab === "messages" ? <MessageEditor state={state} update={update} /> : null}
              {activeTab === "delivery" ? <DeliveryEditor state={state} update={update} /> : null}
              {activeTab === "business" ? <BusinessEditor state={state} update={update} /> : null}
            </Panel>
            <CompanyPreview companies={result?.companies || []} />
          </div>

          <aside className="space-y-3 xl:sticky xl:top-3">
            <Panel title="Campaign readiness" description="Validate, preview, and prepare without starting outreach.">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><span className="block text-slate-400">Audience</span><strong className="mt-1 block text-slate-950">{exactAudience === null ? "Not previewed" : `${formatNumber(exactAudience)} exact`}</strong></div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><span className="block text-slate-400">Draft</span><strong className="mt-1 block truncate text-slate-950">{campaignId || "Not created"}</strong></div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><span className="block text-slate-400">Messages</span><strong className="mt-1 block text-slate-950">{state.brief.outreachMessages.length}</strong></div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5"><span className="block text-slate-400">Schedule</span><strong className="mt-1 block text-slate-950">{state.brief.deliverySettings.confirmed ? "Confirmed" : "Needs review"}</strong></div>
                </div>
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
                  Prepare creates a private disabled draft. It never starts sending.
                </p>
                <button type="button" className={`${primaryButtonClass} w-full`} disabled={!canCall || Boolean(busy)} onClick={() => void runAction("prepare")}>{busy === "prepare" ? "Preparing…" : "Prepare private draft"}</button>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={`${subtleButtonClass} px-2`} disabled={!canCall || Boolean(busy)} onClick={() => void runAction("validate")}>{busy === "validate" ? "Validating…" : "Validate"}</button>
                  <button type="button" className={`${subtleButtonClass} px-2`} disabled={!canCall || Boolean(busy)} onClick={() => void runAction("preview")}>{busy === "preview" ? "Previewing…" : "Preview audience"}</button>
                </div>
                <button type="button" className={`${subtleButtonClass} w-full border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`} disabled={!canCall || Boolean(busy) || !campaignId} onClick={() => void runAction("preflight")}>{busy === "preflight" ? "Requesting…" : "Request launch review"}</button>
                <button type="button" className="w-full py-2 text-xs font-bold text-slate-500 transition hover:text-slate-950 disabled:opacity-40" disabled={Boolean(busy) || !dirty} onClick={() => void sync()}>{busy === "sync" ? "Syncing…" : "Sync edits to agent"}</button>
              </div>
            </Panel>

            {result ? (
              <Panel
                title={result.setupUrl ? "Browser setup required" : result.failed ? "Needs attention" : "Latest result"}
                action={<TonePill tone={result.failed || result.setupUrl ? "amber" : "green"}>{result.tool.replaceAll("_", " ")}</TonePill>}
              >
                <div className="space-y-3">
                  <p className="text-sm font-semibold leading-6 text-slate-800">{result.summary}</p>
                  {result.blockers.length ? (
                    <ul className="space-y-2">{result.blockers.map((blocker) => <li key={blocker} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-800">{blocker}</li>)}</ul>
                  ) : null}
                  {result.setupUrl ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs font-bold text-blue-950">Connect the sending browser</p>
                      <p className="mt-1 text-xs leading-5 text-blue-800">{result.setupState === "offline" ? "The linked extension is offline. Open its browser and reconnect it, then request launch review again." : "DM Faster will detect this browser, open the correct extension store, and link it to the workspace."}</p>
                      <button type="button" className={`${subtleButtonClass} mt-3 w-full border-blue-300 bg-white`} onClick={() => void bridge.openLink(result.setupUrl)}>Open browser setup</button>
                    </div>
                  ) : null}
                  {result.approvalUrl ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-bold text-amber-900">Owner approval required</p>
                      {result.confirmationCode ? <p className="mt-1 font-mono text-xs text-amber-800">Code: {result.confirmationCode}</p> : null}
                      <button type="button" className={`${subtleButtonClass} mt-3 w-full border-amber-300 bg-white`} onClick={() => void bridge.openLink(result.approvalUrl)}>Open approval</button>
                    </div>
                  ) : null}
                  <details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">Structured tool result</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[10px] leading-5 text-slate-100">{JSON.stringify(result.raw, null, 2)}</pre></details>
                </div>
              </Panel>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("DM Faster campaign workspace root is missing.");
createRoot(root).render(<App />);

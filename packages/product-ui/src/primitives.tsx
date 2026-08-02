import { memo, type ReactNode } from "react";

export const inputClass =
  "h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 lg:h-10 lg:text-sm";
export const textareaClass =
  "min-h-[140px] w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-base leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-slate-950 focus:ring-2 focus:ring-slate-950/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 lg:text-sm";
export const subtleButtonClass =
  "inline-flex h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950/15 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10";
export const dangerButtonClass =
  "inline-flex h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10";
export const primaryButtonClass =
  "inline-flex h-11 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 lg:h-10";
export const numberInputClass =
  `${inputClass} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

export function TonePill({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "blue" | "amber";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "blue"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[0.7rem] font-semibold leading-none ${toneClass}`}
    >
      {children}
    </span>
  );
}

export function PageIntro({
  eyebrow,
  title,
  body,
  actions,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  return (
    <header>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="max-w-3xl">
          {eyebrow ? (
            <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
          ) : null}
          <h1 className={`${eyebrow ? "mt-1.5 " : ""}text-[1.8rem] font-bold leading-[1.08] tracking-[-0.035em] text-slate-950 sm:text-3xl`}>
            {title}
          </h1>
          {body ? (
            <p className="mt-2 max-w-[48rem] text-[0.9375rem] leading-6 text-slate-600">
              {body}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Panel({
  title,
  description,
  action,
  children,
  className = "",
  contentClassName = "p-4 sm:p-5",
  ariaLabel,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  ariaLabel?: string;
}) {
  const hasHeader = Boolean(title || description || action);

  return (
    <section
      aria-label={ariaLabel || (!title ? description : undefined)}
      className={`overflow-hidden rounded-2xl border border-slate-200/90 bg-white lg:rounded-xl ${className}`}
    >
      {hasHeader ? (
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div>
            {title ? (
              <h2 className="text-lg font-bold leading-tight tracking-[-0.01em] text-slate-950">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className={`${title ? "mt-1.5" : ""} text-sm leading-6 text-slate-600`}>{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex w-full items-center sm:w-auto sm:shrink-0 sm:justify-end">{action}</div> : null}
        </div>
      ) : null}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

export const CampaignToggle = memo(function CampaignToggle({
  checked,
  ariaLabel,
  disabled = false,
  pending = false,
  testId,
  onChange,
}: {
  checked: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  pending?: boolean;
  testId?: string;
  onChange: (nextChecked: boolean) => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      aria-busy={pending}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full border px-1 transition-colors duration-150 ease-out ${
        checked
          ? "border-slate-950 bg-slate-950 hover:bg-slate-800"
          : "border-slate-300 bg-slate-100 hover:border-slate-400 hover:bg-white"
      } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer touch-manipulation"}`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transform-gpu transition-transform duration-150 ease-out will-change-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
});

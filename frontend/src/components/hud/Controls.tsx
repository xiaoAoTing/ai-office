"use client";

import { useEffect, useRef } from "react";
import { FPS_OPTIONS } from "@/lib/frameRate";
import { card } from "@/components/panels/ui";
import { LANGS, useLangStore, useT } from "@/lib/i18n";
import { type FloorSelection, useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";

const pill =
  "rounded-full px-3.5 py-1.5 text-xs font-medium whitespace-nowrap tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** 15 | 30 | 60: how often the scene is drawn (fewer frames leave the graphics card to the model). */
function FpsSwitch() {
  const t = useT();
  const fps = useUiStore((s) => s.fps);
  const setFps = useUiStore((s) => s.setFps);
  return (
    <div role="radiogroup" aria-label={t("hud.fpsChoice")} title={t("hud.fpsChoice")} className="flex items-center gap-0.5 rounded-full bg-ink/5 p-0.5" data-testid="fps-switch">
      {FPS_OPTIONS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={fps === value}
          onClick={() => setFps(value)}
          className={`rounded-full px-2 py-1 font-mono text-[10px] font-semibold transition ${fps === value ? "bg-white text-ink shadow-sm" : "text-ink/45 hover:text-ink"}`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

/** EN | RU | ZH: the interface language, remembered in the browser (English until changed). */
function LanguageSwitch() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const restore = useLangStore((s) => s.restore);
  useEffect(() => restore(), [restore]);
  return (
    <div role="radiogroup" aria-label={t("common.language")} className="flex gap-0.5 rounded-full bg-ink/5 p-0.5" data-testid="language-switch">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          onClick={() => setLang(l)}
          className={`rounded-full px-2 py-1 font-mono text-[10px] font-semibold tracking-wider uppercase transition ${lang === l ? "bg-white text-ink shadow-sm" : "text-ink/45 hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** One labelled row of the settings popover: name and current state on the left, control on the right. */
function SettingsRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink/45">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** On/off switch for a settings row; the hint text above it already says what on and off mean. */
function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-accent" : "bg-ink/20"}`}
    >
      <span className={`absolute top-0.5 left-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

export function FloorControls() {
  const t = useT();
  const floors = useWorldStore((s) => s.world?.floors);
  const selected = useUiStore((s) => s.selectedFloor);
  const selectFloor = useUiStore((s) => s.selectFloor);

  const numbers = (floors ?? []).map((f) => f.number).sort((a, b) => a - b);
  const options: { value: FloorSelection; label: string }[] = [
    { value: "all", label: t("hud.allFloors") },
    ...numbers.map((n) => ({ value: n, label: String(n) })),
  ];

  return (
    <div data-testid="floor-controls" className="pointer-events-auto flex w-fit items-center gap-2 rounded-full border border-line bg-white/90 p-1.5 shadow-[0_12px_40px_-18px_rgba(20,22,31,0.45)] backdrop-blur">
        <span className="pl-2.5 pr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">{t("hud.floor")}</span>
        <div role="radiogroup" aria-label={t("hud.floorChoice")} className="flex gap-1">
          {options.map((o) => {
            const active = o.value === selected;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectFloor(o.value)}
                className={`${pill} ${active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/5"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
    </div>
  );
}

/**
 * Scene preferences: animation, office life, frame rate and language.
 * They apply to the whole office, not to one floor, so they live behind a gear in the corner —
 * not inside the floor strip, which is only about which floors you are looking at.
 */
export function SettingsControl() {
  const t = useT();
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const animation = useUiStore((s) => s.animation);
  const setAnimation = useUiStore((s) => s.setAnimation);
  const life = useUiStore((s) => s.life);
  const setLife = useUiStore((s) => s.setLife);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, setOpen]);

  return (
    <div ref={box} className="pointer-events-auto relative" data-testid="settings-control">
      <button
        type="button"
        data-testid="settings-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("hud.settings")}
        title={t("hud.settings")}
        className={`grid h-9 w-9 place-items-center rounded-full border shadow-[0_12px_40px_-18px_rgba(20,22,31,0.45)] backdrop-blur transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${open ? "border-transparent bg-ink text-paper" : "border-line bg-white/90 text-ink/70 hover:bg-ink/5 hover:text-ink"}`}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("hud.settings")}
          data-testid="settings-panel"
          className={`${card} absolute right-0 top-full z-20 mt-2 flex w-80 flex-col gap-4 p-4`}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/50">{t("hud.settings")}</p>
          <SettingsRow label={t("hud.animation")} hint={animation ? t("hud.animationOn") : t("hud.animationOff")}>
            <Switch on={animation} onChange={setAnimation} label={t("hud.animation")} />
          </SettingsRow>
          <SettingsRow label={t("hud.life")} hint={life ? t("hud.lifeOn") : t("hud.lifeOff")}>
            <Switch on={life && animation} onChange={setLife} disabled={!animation} label={t("hud.life")} />
          </SettingsRow>
          <span className="h-px bg-ink/10" />
          <SettingsRow label={t("hud.fps")} hint={t("hud.fpsChoice")}>
            <FpsSwitch />
          </SettingsRow>
          <SettingsRow label={t("common.language")}>
            <LanguageSwitch />
          </SettingsRow>
        </div>
      )}
    </div>
  );
}

/**
 * Reset the view: back to the home camera, no agent followed. It sits with the gear in the top corner —
 * the bottom-left one belongs to the Next.js dev overlay's issues badge in dev mode, and the two would collide.
 */
export function HomeButton() {
  const t = useT();
  const requestHome = useUiStore((s) => s.requestHome);
  return (
    <button
      type="button"
      data-testid="home-button"
      onClick={requestHome}
      aria-label={t("hud.homeTitle")}
      title={t("hud.homeTitle")}
      className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full border border-line bg-white/90 text-ink/70 shadow-[0_12px_40px_-18px_rgba(20,22,31,0.45)] backdrop-blur transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function PreviewBadge() {
  const preview = useUiStore((s) => s.preview);
  if (!preview) return null;
  return (
    <div className="pointer-events-none rounded-full bg-accent px-3 py-1.5 font-mono text-[10px] font-semibold whitespace-nowrap uppercase tracking-[0.2em] text-white shadow">
      Preview
    </div>
  );
}

export function WorldError() {
  const t = useT();
  const status = useWorldStore((s) => s.status);
  const hasWorld = useWorldStore((s) => s.world !== null);
  if (status !== "error" || hasWorld) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="rounded-lg bg-white/85 px-4 py-3 font-mono text-xs text-ink/70 shadow">
        {t("api.noState")}
      </p>
    </div>
  );
}

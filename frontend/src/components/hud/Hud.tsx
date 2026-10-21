"use client";

import { PANEL_WIDTH } from "@/components/panels/ui";
import { useRightPanelOpen } from "@/components/panels/RightPanel";
import { useT } from "@/lib/i18n";
import { useUiStore } from "@/store/useUiStore";
import { ApiStatus } from "./ApiStatus";
import { FloorControls, HomeButton, PreviewBadge, SettingsControl } from "./Controls";
import { ListDock } from "./ListDock";
import { Metrics } from "./Metrics";
import { ModelStatus } from "./ModelStatus";
import { Notices } from "./Notices";
import { Search } from "./Search";
import { StageRibbon } from "./StageRibbon";

const GAP = 16;

function DirectorButton() {
  const t = useT();
  const select = useUiStore((s) => s.select);
  const setDirectorOpen = useUiStore((s) => s.setDirectorOpen);
  return (
    <button
      type="button"
      data-testid="open-director"
      onClick={() => {
        select({ kind: "director" });
        setDirectorOpen(true);
      }}
      className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium whitespace-nowrap text-paper shadow-[0_12px_40px_-18px_rgba(20,22,31,0.6)] transition hover:bg-ink/85"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
        <path d="M2.5 6.5h11M6 9.5h4" strokeLinecap="round" />
      </svg>
      {t("hud.director")}
    </button>
  );
}

/**
 * Overlay frame: a top row (brand, metrics and floors | search | camera home, settings, director) and a
 * bottom row (stage ribbon | list). Both rows stop short of the right panel while it is open, so nothing
 * overlaps. The bottom-left corner is left free: the Next.js dev overlay parks its "issues" badge there.
 */
export function Hud() {
  const panelOpen = useRightPanelOpen();
  const inset = { left: GAP, right: GAP + (panelOpen ? PANEL_WIDTH + GAP : 0) };

  return (
    <>
      <div className="pointer-events-none absolute top-4 flex items-start gap-4" style={inset}>
        <div className="flex w-[300px] shrink-0 flex-col gap-3">
          <div className="select-none">
            <p className="font-mono text-[10px] tracking-[0.25em] text-ink/45 uppercase">Local HQ</p>
            <h1 className="text-lg font-semibold tracking-tight text-ink">AI Office</h1>
          </div>
          <Metrics />
          <FloorControls />
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
          <Search />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <PreviewBadge />
            <ApiStatus />
            <ModelStatus />
            <HomeButton />
            <SettingsControl />
            <DirectorButton />
          </div>
          <Notices />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 flex items-end justify-end gap-4" style={inset}>
        <div className="flex min-w-0 flex-1 justify-center">
          <StageRibbon />
        </div>
        <div className="shrink-0">
          <ListDock />
        </div>
      </div>
    </>
  );
}

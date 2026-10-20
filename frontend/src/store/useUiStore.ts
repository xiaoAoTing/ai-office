import { create } from "zustand";
import { DEFAULT_FPS, type Fps, parseFps } from "@/lib/frameRate";
import { type Selection, selectionKey } from "@/scene/layout";

export type FloorSelection = "all" | number;

export type HudBlock = "metrics" | "list" | "ribbon";

type UiStore = {
  selectedFloor: FloorSelection;
  preview: boolean;
  routes: boolean;
  homeRequest: number;
  /** What the director picked; the scene only reads it. */
  selection: Selection | null;
  hovered: string | null;
  taskId: number | null;
  directorOpen: boolean;
  /** Camera flight request: the scene resolves the key to a position once that object is visible. */
  focus: { key: string; nonce: number } | null;
  collapsed: Record<HudBlock, boolean>;
  /** Scene preferences popover (animation, office life, frame rate, language). */
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Animated arrivals and departures; off: people and cars simply appear and disappear (stage 6). */
  animation: boolean;
  /** Office life on top of the animation (coffee, lounge, strolls, talks); off: everyone at their desk. */
  life: boolean;
  setLife: (on: boolean) => void;
  /** Scene frame rate (HUD switch, remembered in the browser). */
  fps: Fps;
  setFps: (fps: Fps) => void;
  /** Agent the camera follows (person or car), if any. */
  follow: number | null;
  setAnimation: (on: boolean) => void;
  setFollow: (agentId: number | null) => void;
  selectFloor: (floor: FloorSelection) => void;
  setPreview: (preview: boolean) => void;
  setRoutes: (routes: boolean) => void;
  requestHome: () => void;
  select: (selection: Selection | null) => void;
  hover: (key: string | null) => void;
  openTask: (taskId: number | null) => void;
  setDirectorOpen: (open: boolean) => void;
  /** Select, show the object's floor and fly the camera to it. */
  focusOn: (selection: Selection, floorNumber: number | null) => void;
  toggle: (block: HudBlock) => void;
  /** Esc: closes the innermost layer only. */
  back: () => void;
};

const ANIMATION_KEY = "ai-office:animation";
const LIFE_KEY = "ai-office:life";
const FPS_KEY = "ai-office:fps";
const COLLAPSED_KEY = "ai-office:hud-collapsed";

/** Every HUD block open at first; the director's own folds are read after hydration. */
export const DEFAULT_COLLAPSED: Record<HudBlock, boolean> = { metrics: false, list: false, ribbon: false };

/** The director's last fold of each HUD block (read after hydration, like `storedAnimation`). */
export function storedCollapsed(): Record<HudBlock, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}") as Partial<Record<HudBlock, boolean>>;
    return { ...DEFAULT_COLLAPSED, ...saved };
  } catch {
    return DEFAULT_COLLAPSED;
  }
}

/** The director's last frame rate (read after hydration, like `storedAnimation`). */
export function storedFps(): Fps {
  try {
    return parseFps(localStorage.getItem(FPS_KEY));
  } catch {
    return DEFAULT_FPS;
  }
}

/** The director's last choice for office life (read after hydration, like `storedAnimation`). */
export function storedLife(): boolean {
  try {
    return localStorage.getItem(LIFE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The director's last choice, read after hydration (the server always renders with animation on). */
export function storedAnimation(): boolean {
  try {
    return localStorage.getItem(ANIMATION_KEY) !== "0";
  } catch {
    return true;
  }
}

export const useUiStore = create<UiStore>((set, get) => ({
  selectedFloor: "all",
  preview: false,
  routes: false,
  homeRequest: 0,
  selection: null,
  hovered: null,
  taskId: null,
  directorOpen: false,
  focus: null,
  collapsed: DEFAULT_COLLAPSED,
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  animation: true,
  life: true,
  fps: DEFAULT_FPS,
  setFps: (fps) => {
    try {
      localStorage.setItem(FPS_KEY, String(fps));
    } catch {}
    set({ fps });
  },
  setLife: (life) => {
    try {
      localStorage.setItem(LIFE_KEY, life ? "1" : "0");
    } catch {}
    set({ life });
  },
  follow: null,
  setAnimation: (animation) => {
    try {
      localStorage.setItem(ANIMATION_KEY, animation ? "1" : "0");
    } catch {}
    set({ animation, follow: animation ? get().follow : null });
  },
  setFollow: (follow) => set({ follow }),
  selectFloor: (selectedFloor) => set({ selectedFloor }),
  setPreview: (preview) => set({ preview }),
  setRoutes: (routes) => set({ routes }),
  requestHome: () => set((s) => ({ homeRequest: s.homeRequest + 1, follow: null })),
  select: (selection) =>
    set((s) => {
      const same = s.selection && selection && selectionKey(s.selection) === selectionKey(selection);
      const keepFollow = selection?.kind === "agent" && selection.id === s.follow;
      return { selection, taskId: same ? s.taskId : null, follow: keepFollow ? s.follow : null };
    }),
  hover: (hovered) => {
    if (get().hovered !== hovered) set({ hovered });
  },
  openTask: (taskId) => set({ taskId }),
  setDirectorOpen: (directorOpen) => set({ directorOpen }),
  focusOn: (selection, floorNumber) => {
    get().select(selection);
    set((s) => ({
      selectedFloor: floorNumber ?? s.selectedFloor,
      focus: { key: selectionKey(selection), nonce: (s.focus?.nonce ?? 0) + 1 },
    }));
  },
  toggle: (block) =>
    set((s) => {
      const collapsed = { ...s.collapsed, [block]: !s.collapsed[block] };
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
      } catch {}
      return { collapsed };
    }),
  back: () => {
    const s = get();
    if (s.settingsOpen) set({ settingsOpen: false });
    else if (s.directorOpen) set({ directorOpen: false, selection: s.selection?.kind === "director" ? null : s.selection });
    else if (s.taskId !== null) set({ taskId: null });
    else if (s.selection) set({ selection: null });
  },
}));

export function isFloorVisible(floorNumber: number, selected: FloorSelection): boolean {
  return selected === "all" || floorNumber <= selected;
}

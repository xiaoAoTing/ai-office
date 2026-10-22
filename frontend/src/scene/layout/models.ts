/**
 * Primitive models as parts in local coordinates (origin on the floor, front = +z unless noted).
 * Callers position them with `place()`; these functions own only the proportions of each model.
 */
import { PALETTE } from "@/scene/palette";
import { DIM } from "./dims";
import { type Part, type Vec3, cube, part } from "./types";

/** Executive office chair, the sitter faces −z (backrest on +z). */
export function officeChair(color: string = PALETTE.chair, ghost = false): Part[] {
  const f = ghost ? "ghost" : "matte";
  const base: Part[] = Array.from({ length: 5 }, (_, k) =>
    cube([0, 0.05, 0], [0.06, 0.04, 0.62], ghost ? PALETTE.free : PALETTE.steel, f, [0, (k * 2 * Math.PI) / 5, 0]),
  );
  return [
    ...base,
    part("cylinder", [0, 0.27, 0], [0.07, 0.42, 0.07], ghost ? PALETTE.free : PALETTE.metal, f),
    cube([0, DIM.chair.seat, 0], [0.56, 0.09, 0.54], color, f),
    cube([0, 1.0, 0.27], [0.56, 0.86, 0.09], color, f, [-0.08, 0, 0]),
    cube([0, 1.47, 0.31], [0.4, 0.18, 0.08], color, f, [-0.08, 0, 0]),
    ...[-1, 1].flatMap((s) => [
      cube([s * 0.31, 0.62, 0.02], [0.05, 0.22, 0.05], PALETTE.steel, f),
      cube([s * 0.31, 0.74, 0], [0.07, 0.05, 0.42], color, f),
    ]),
  ];
}

/** Seated person facing −z; origin is the seat surface. */
export function seatedPerson(outfit: string): Part[] {
  return [
    cube([0, 0.08, -0.13], [0.38, 0.15, 0.46], PALETTE.trousers),
    cube([0, -0.2, -0.38], [0.34, 0.42, 0.14], PALETTE.trousers),
    part("cylinder", [0, 0.42, 0.04], [0.4, 0.56, 0.3], outfit),
    ...[-1, 1].map((s) => part("cylinder", [s * 0.25, 0.42, -0.14], [0.11, 0.42, 0.11], outfit, "matte", [-1.05, 0, 0])),
    part("sphere", [0, 0.9, 0.02], [0.3, 0.32, 0.3], PALETTE.skin),
    part("sphere", [0, 0.97, 0.06], [0.32, 0.2, 0.32], PALETTE.hair),
  ];
}

// The display is recessed into the monitor shell: its front is flush with the
// shell's 0.035-thick front face.
export const MONITOR_SCREEN = { width: 0.59, height: 0.34, surfaceOffset: 0.0175, depth: 0.005 } as const;

function monitor(x: number, yaw: number, on: boolean, ghost: boolean, hasContent: boolean): Part[] {
  const f = ghost ? "ghost" : "matte";
  const frame = ghost ? PALETTE.free : PALETTE.dark;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (dx: number, dz: number): [number, number] => [x + dx * c + dz * s, -dx * s + dz * c];
  const [sx, sz] = at(0, MONITOR_SCREEN.surfaceOffset - MONITOR_SCREEN.depth / 2);
  return [
    cube([x, 0.76, -0.27], [0.24, 0.02, 0.16], frame, f),
    cube([x, 0.88, -0.29], [0.05, 0.24, 0.05], ghost ? PALETTE.free : PALETTE.metal, f),
    cube([x, 1.11, -0.28], [0.64, 0.39, 0.035], frame, f, [0, yaw, 0]),
    ...((ghost || hasContent) ? [] : [cube([sx, 1.11, -0.28 + sz], [MONITOR_SCREEN.width, MONITOR_SCREEN.height, MONITOR_SCREEN.depth], on ? PALETTE.screenOn : PALETTE.screen, on ? "screen" : "matte", [0, yaw, 0])]),
  ];
}

/** Desk with two monitors, speakers, keyboard and a water bottle; the user sits on +z facing −z. */
export function workstation(occupied: boolean, present: boolean, hasScreenContent = false): Part[] {
  const ghost = !occupied;
  const f = ghost ? "ghost" : "matte";
  const { w, d, h } = DIM.desk;
  const top = ghost ? PALETTE.free : PALETTE.deskTop;
  const frame = ghost ? PALETTE.free : PALETTE.wood;
  const parts: Part[] = [
    cube([0, h - 0.025, 0], [w, 0.05, d], top, f),
    ...[-1, 1].map((s) => cube([s * (w / 2 - 0.04), (h - 0.05) / 2, 0], [0.06, h - 0.05, d * 0.92], frame, f)),
    cube([0, 0.48, -d / 2 + 0.04], [w - 0.12, 0.42, 0.03], frame, f),
    ...monitor(-0.34, 0.14, present, ghost, hasScreenContent),
    ...monitor(0.34, -0.14, present, ghost, hasScreenContent),
    ...officeChair(ghost ? PALETTE.free : PALETTE.chair, ghost).map((p) => ({
      ...p,
      position: [p.position[0], p.position[1], p.position[2] + DIM.chair.offset] as Vec3,
    })),
  ];
  if (!ghost) {
    parts.push(
      ...[-1, 1].map((s) => cube([s * 0.82, h + 0.09, -0.27], [0.11, 0.18, 0.11], PALETTE.dark)),
      cube([0, h + 0.012, 0.08], [0.46, 0.02, 0.15], PALETTE.dark),
      cube([0.34, h + 0.012, 0.1], [0.06, 0.02, 0.1], PALETTE.dark),
      part("cylinder", [0.8, h + 0.13, 0.22], [0.08, 0.24, 0.08], PALETTE.water, "glass"),
      part("cylinder", [0.8, h + 0.27, 0.22], [0.05, 0.04, 0.05], PALETTE.steel),
    );
  }
  return parts;
}

export function sofa(length = 2.4, color: string = PALETTE.fabric): Part[] {
  return [
    cube([0, 0.22, 0], [length, 0.44, 0.9], color),
    cube([0, 0.62, -0.36], [length, 0.5, 0.18], color),
    ...[-1, 1].map((s) => cube([(s * (length - 0.18)) / 2, 0.36, 0], [0.18, 0.72, 0.9], PALETTE.fabricDark)),
  ];
}

export const armchair = () => sofa(1, PALETTE.fabricDark);

export function lowTable(w = 1.2, d = 0.7, h = 0.4): Part[] {
  return [cube([0, h / 2, 0], [w, h, d], PALETTE.wood)];
}

export function diningTable(w = 1.6, d = 0.9): Part[] {
  return [
    cube([0, 0.74, 0], [w, 0.05, d], PALETTE.deskTop),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => cube([sx * (w / 2 - 0.08), 0.36, sz * (d / 2 - 0.08)], [0.05, 0.72, 0.05], PALETTE.steel))),
  ];
}

/** Simple chair, sitter faces −z. */
export function simpleChair(): Part[] {
  return [
    cube([0, 0.45, 0], [0.44, 0.05, 0.42], PALETTE.wood),
    cube([0, 0.75, 0.19], [0.44, 0.5, 0.04], PALETTE.wood),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => cube([sx * 0.19, 0.22, sz * 0.18], [0.04, 0.44, 0.04], PALETTE.steel))),
  ];
}

export function pottedPlant(scale = 1): Part[] {
  return [
    part("cylinder", [0, 0.22 * scale, 0], [0.46 * scale, 0.44 * scale, 0.46 * scale], PALETTE.pot),
    part("ico", [0, 0.85 * scale, 0], [0.9 * scale, 0.9 * scale, 0.9 * scale], PALETTE.plant, "foliage"),
    part("ico", [0.12 * scale, 1.25 * scale, 0.05 * scale], [0.56 * scale, 0.56 * scale, 0.56 * scale], PALETTE.plant, "foliage"),
  ];
}

export function bookshelf(): Part[] {
  return [
    cube([0, 1, 0], [2, 2, 0.4], PALETTE.darkWood),
    ...[0.5, 1, 1.5].map((y) => cube([0, y, 0.12], [1.85, 0.32, 0.2], PALETTE.fabric)),
  ];
}

/** Two-seat reception counter; staff sit on −z and face +z (towards the entrance). */
export function receptionDesk(): Part[] {
  return [
    cube([0, 0.55, 0.15], [4.4, 1.1, 0.6], PALETTE.slab),
    cube([0, 1.13, 0.2], [4.6, 0.06, 0.8], PALETTE.darkWood),
    cube([0, 0.55, 0.46], [4.4, 0.08, 0.02], PALETTE.accent, "decal"),
    cube([0, 0.75, -0.3], [4.4, 0.04, 0.6], PALETTE.deskTop),
    ...[-0.95, 0.95].flatMap((x) => [
      cube([x, 0.9, -0.25], [0.56, 0.34, 0.04], PALETTE.dark, "matte", [0, Math.PI, 0]),
      cube([x, 0.9, -0.272], [0.5, 0.29, 0.005], PALETTE.screenOn, "screen", [0, Math.PI, 0]),
    ]),
  ];
}

export function kitchen(length: number): Part[] {
  return [
    cube([0, 0.45, 0], [length, 0.9, 0.65], PALETTE.counter),
    cube([0, 0.92, 0], [length, 0.04, 0.68], PALETTE.darkWood),
    cube([-length * 0.15, 0.93, 0.02], [0.6, 0.02, 0.4], PALETTE.steel),
    part("cylinder", [-length * 0.15, 1.12, -0.18], [0.04, 0.36, 0.04], PALETTE.metal),
    cube([length * 0.18, 1.12, -0.05], [0.32, 0.38, 0.36], PALETTE.dark),
    cube([length * 0.18, 1.0, 0.12], [0.12, 0.08, 0.04], PALETTE.metal),
    cube([0, 1.85, -0.17], [length, 0.7, 0.34], PALETTE.counter),
  ];
}

/** A server rack: dark cabinet, front panel and a column of status LEDs (green idle, amber busy). */
export function serverRack(busy: boolean): Part[] {
  const { w, d, h } = DIM.server.rack;
  const led = busy ? PALETTE.ledBusy : PALETTE.ledIdle;
  return [
    cube([0, h / 2, 0], [w, h, d], PALETTE.rack),
    cube([0, h / 2, d / 2 + 0.01], [w - 0.08, h - 0.12, 0.02], PALETTE.rackPanel),
    ...Array.from({ length: DIM.server.leds }, (_, i) => cube([w / 2 - 0.12, 0.35 + i * 0.32, d / 2 + 0.03], [0.06, 0.06, 0.02], led, "screen")),
    ...Array.from({ length: 4 }, (_, i) => cube([-0.06, 0.3 + i * 0.42, d / 2 + 0.025], [w - 0.32, 0.12, 0.01], PALETTE.dark)),
  ];
}

export function coolingUnit(): Part[] {
  return [cube([0, 0.9, 0], [0.7, 1.8, 0.6], PALETTE.appliance), cube([0, 1.5, 0.31], [0.5, 0.3, 0.02], PALETTE.steel)];
}

/** Coffee machine standing on the counter (origin on the counter top), front +z. */
export function coffeeMachine(): Part[] {
  return [
    cube([0, 0.2, 0], [0.32, 0.4, 0.34], PALETTE.dark),
    cube([0, 0.03, 0.08], [0.24, 0.04, 0.16], PALETTE.steel),
    cube([0, 0.26, 0.172], [0.16, 0.08, 0.01], PALETTE.screenOn, "screen"),
    part("cylinder", [0, 0.09, 0.07], [0.08, 0.1, 0.08], PALETTE.mug),
  ];
}

/** A mug; origin on the surface it stands on. */
export function mug(): Part[] {
  return [part("cylinder", [0, 0.05, 0], [0.08, 0.1, 0.08], PALETTE.mug), cube([0.05, 0.05, 0], [0.025, 0.05, 0.012], PALETTE.mug)];
}

export function fridge(): Part[] {
  return [
    cube([0, 0.95, 0], [0.75, 1.9, 0.7], PALETTE.appliance),
    cube([0.28, 1.15, 0.36], [0.04, 0.5, 0.04], PALETTE.steel),
    cube([0, 1.32, 0.352], [0.74, 0.01, 0.01], PALETTE.metal, "decal"),
  ];
}

/** Car with its nose towards −z. */
export function car(color: string): Part[] {
  return [
    cube([0, 0.5, 0], [1.8, 0.5, 4], color),
    cube([0, 0.95, 0.25], [1.6, 0.42, 2.1], color),
    cube([0, 0.95, 0.25], [1.64, 0.3, 1.8], PALETTE.dark),
    ...[-1, 1].flatMap((sx) =>
      [-1, 1].map((sz) => part("cylinder", [sx * 0.86, 0.32, sz * 1.25], [0.64, 0.24, 0.64], PALETTE.dark, "matte", [0, 0, Math.PI / 2])),
    ),
  ];
}

export function conifer(variant: number): Part[] {
  return [
    part("cylinder", [0, 0.6, 0], [0.3, 1.2, 0.3], PALETTE.trunk),
    part("cone", [0, 2.1, 0], [2.1, 2.4, 2.1], PALETTE.conifer, "foliage"),
    ...(variant === 1 ? [] : [part("cone", [0, 3.2, 0], [1.4, 1.6, 1.4], PALETTE.conifer, "foliage")]),
  ];
}

export function deciduous(variant: number): Part[] {
  const leaf = PALETTE.leaf[variant % PALETTE.leaf.length];
  const blobs: [Vec3, number][] = [
    [[0, 2.5, 0], 2.5],
    [[0.7, 2.1, 0.3], 1.7],
    [[-0.6, 2.2, -0.4], 1.6],
  ];
  return [
    part("cylinder", [0, 0.9, 0], [0.34, 1.8, 0.34], PALETTE.trunk),
    ...blobs.slice(0, variant === 2 ? 2 : 3).map(([p, r]) => part("ico", p, [r, r, r], leaf, "foliage")),
  ];
}

export function bush(variant: number): Part[] {
  const blobs: [Vec3, number][] = [
    [[0, 0.38, 0], 1],
    [[0.45, 0.3, 0.15], 0.72],
    [[-0.4, 0.28, -0.1], 0.68],
  ];
  return blobs.slice(0, variant === 0 ? 3 : 2).map(([p, r]) => part("ico", p, [r, r, r], PALETTE.bush, "foliage"));
}

export function flowerBed(variant: number): Part[] {
  const flowers: Part[] = Array.from({ length: 12 }, (_, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const color = i % 3 === 0 ? PALETTE.bush : PALETTE.flowers[(i + variant) % PALETTE.flowers.length];
    return part("ico", [-1.05 + col * 0.7, 0.42, -0.45 + row * 0.45], [0.28, 0.28, 0.28], color, "foliage");
  });
  return [cube([0, 0.15, 0], [3, 0.3, 1.4], PALETTE.curb), cube([0, 0.31, 0], [2.8, 0.04, 1.2], PALETTE.soil), ...flowers];
}

export function hvacUnit(): Part[] {
  return [
    cube([0, 0.6, 0], [2.2, 1.2, 1.4], PALETTE.hvac),
    cube([0, 1.22, 0], [2.3, 0.06, 1.5], PALETTE.steel),
    ...[-0.6, 0, 0.6].map((x) => cube([x, 0.7, 0.71], [0.4, 0.8, 0.02], PALETTE.steel, "decal")),
  ];
}

export function acUnit(): Part[] {
  return [
    cube([0, 0.4, 0], [1, 0.8, 0.8], PALETTE.appliance),
    part("cylinder", [0, 0.81, 0], [0.62, 0.04, 0.62], PALETTE.steel, "decal"),
    part("cylinder", [0, 0.83, 0], [0.12, 0.04, 0.12], PALETTE.dark, "decal"),
  ];
}

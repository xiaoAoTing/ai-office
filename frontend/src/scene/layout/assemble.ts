/**
 * Turns world data into a declarative scene: instanced parts, fading walls, labels and the roof.
 * Everything positional is decided here; components only render the result.
 */
import { PALETTE, carColor, outfitColor } from "@/scene/palette";
import {
  type BuildingLayout,
  type EntranceLayout,
  type FloorLayout,
  type WallMesh,
  buildingLayout,
  columnPositions,
  coreLayout,
  deskIndices,
  deskTransform,
  elevatorOpening,
  entranceLayout,
  floorWalls,
  kitchenLayout,
  loungeLayout,
  officeFurniture,
  partitionLayout,
  receptionLayout,
  serverRoomLayout,
  roofLayout,
  stairStorey,
  storeyHeight,
} from "./building";
import { DIM } from "./dims";
import { greenery } from "./greenery";
import * as M from "./models";
import { type Pick, deskPick, directorPick, serverPick, spotPick } from "./picks";
import { type MovingSpec, movingSpec } from "./moving";
import { type Routes, type SiteLayout, routes, siteLayout } from "./site";
import { type Box, type FloorInput, type Part, type Placement, type Rect, type Vec3, boxIn, cube, part, place, rectCenter, rectSize } from "./types";

/** `status`/`statusColor` arrive already localised: the layout only places them. */
export type AgentInput = { id: number; deskIndex: number; roleKey: string; title: string; atDesk: boolean; carParked: boolean; drawn?: boolean; status: string; statusColor: string; screenMode?: "working" | "web" | "loading" | "review" | "idle" };
export type FloorData = FloorInput & { id: number; name: string; agents: AgentInput[] };

export type LabelSpec =
  | { kind: "plaque"; key: string; position: Vec3; text: string; status: string; statusColor: string }
  | { kind: "tag"; key: string; position: Vec3; text: string; status: string; statusColor: string }
  | { kind: "floorSign"; key: string; position: Vec3; number: number; name: string }
  | { kind: "sign"; key: string; position: Vec3; text: string; size: number; color: string; board?: string; faceCamera: boolean }
  | { kind: "ground"; key: string; position: Vec3; text: string; size: number; color: string };

export type Wall = WallMesh & { solidColor: string };

export type SceneSpec = {
  building: BuildingLayout;
  site: SiteLayout;
  entrance: EntranceLayout;
  routes: Routes;
  parts: Part[];
  walls: Wall[];
  labels: LabelSpec[];
  roof: Part[];
  picks: Pick[];
  moving: MovingSpec;
};

const at = (x: number, y: number, z: number, yaw = 0): Placement => ({ position: [x, y, z], yaw });
const boxPart = (b: Box, color: string, finish?: Part["finish"]): Part => cube(b.position, b.size, color, finish, b.rotation);
const shift = (b: Box, dy: number): Box => ({ ...b, position: [b.position[0], b.position[1] + dy, b.position[2]] });
const flat = (r: Rect, y: number, color: string, finish: Part["finish"] = "decal"): Part => {
  const [cx, cz] = rectCenter(r);
  const [w, d] = rectSize(r);
  return cube([cx, y, cz], [w, 0.02, d], color, finish);
};

function workstations(floor: FloorData, f: FloorLayout, parts: Part[], labels: LabelSpec[], picks: Pick[]) {
  const byDesk = new Map(floor.agents.map((a) => [a.deskIndex, a]));
  for (const i of deskIndices(f.capacity)) {
    const t = deskTransform(i);
    const agent = byDesk.get(i);
    const [dx, , dz] = t.desk;
    parts.push(...place(M.workstation(agent !== undefined, agent?.atDesk ?? false, !!agent?.atDesk && !!agent.screenMode), at(dx, f.baseY, dz)));
    picks.push(deskPick(f, i, agent ? { kind: "agent", id: agent.id } : { kind: "desk", floorId: floor.id, deskIndex: i }));
    if (!agent) continue;
    if (agent.atDesk && agent.drawn !== false) parts.push(...place(M.seatedPerson(outfitColor(agent.roleKey)), at(t.seat[0], f.baseY + t.seat[1], t.seat[2])));
    labels.push({ kind: "plaque", key: `plaque-${agent.id}`, position: [t.plaque[0], f.baseY + t.plaque[1], t.plaque[2]], text: agent.title, status: agent.status, statusColor: agent.statusColor });
  }
}

function glassRoom(room: Rect, doorGap: { from: number; to: number }, y: number, key: string): Wall[] {
  const h = 2.7;
  const pane = (x0: number, x1: number, z0: number, z1: number): Box => boxIn({ x0, x1, z0, z1 }, y, y + h);
  const rail = (x0: number, x1: number, z0: number, z1: number): Box => boxIn({ x0, x1, z0, z1 }, y + h - 0.05, y + h + 0.05);
  const t = 0.03;
  return [
    { key: `${key}-l`, normal: [-1, 0], solidColor: PALETTE.accent, solid: [rail(room.x0 - 0.05, room.x0 + 0.05, room.z0, room.z1)], glass: [pane(room.x0 - t, room.x0 + t, room.z0, room.z1)] },
    { key: `${key}-r`, normal: [1, 0], solidColor: PALETTE.accent, solid: [rail(room.x1 - 0.05, room.x1 + 0.05, room.z0, room.z1)], glass: [pane(room.x1 - t, room.x1 + t, room.z0, room.z1)] },
    {
      key: `${key}-f`,
      normal: [0, 1],
      solidColor: PALETTE.accent,
      solid: [rail(room.x0, room.x1, room.z1 - 0.05, room.z1 + 0.05)],
      glass: [pane(room.x0, doorGap.from, room.z1 - t, room.z1 + t), pane(doorGap.to, room.x1, room.z1 - t, room.z1 + t)],
    },
  ];
}

/** `liveStaff`: office life animates the receptionists, so the static ones are left out. */
export type SceneOptions = { serverBusy?: boolean; liveStaff?: boolean };

function serverRoom(b: BuildingLayout, f: FloorLayout, busy: boolean, parts: Part[], walls: Wall[], labels: LabelSpec[], picks: Pick[]) {
  const y = f.baseY;
  const s = serverRoomLayout(b.kitchenZone);
  picks.push(serverPick(f, s.room));
  parts.push(flat({ x0: s.room.x0 + 0.1, x1: s.room.x1 - 0.1, z0: s.room.z0 + 0.1, z1: s.room.z1 - 0.1 }, y + 0.011, PALETTE.rackPanel));
  for (const r of s.racks) parts.push(...place(M.serverRack(busy), at(r.position[0], y, r.position[2], r.yaw)));
  parts.push(...place(M.coolingUnit(), at(s.cooler.position[0], y, s.cooler.position[2], s.cooler.yaw)));
  walls.push(...glassRoom(s.room, s.doorGap, y, `server-${f.number}`));
  labels.push({ kind: "sign", key: `server-${f.number}`, position: [s.sign[0], y + s.sign[1], s.sign[2]], text: "SERVER ROOM", size: 0.22, color: "#ffffff", board: PALETTE.rack, faceCamera: false });
}

function kitchenWithPartition(b: BuildingLayout, f: FloorLayout, parts: Part[], walls: Wall[]) {
  const y = f.baseY;
  const k = kitchenLayout(b.kitchenZone);
  parts.push(...place(M.kitchen(k.counterLength), at(k.counter.position[0], y, k.counter.position[2], k.counter.yaw)));
  parts.push(...place(M.fridge(), at(k.fridge.position[0], y, k.fridge.position[2], k.fridge.yaw)));
  parts.push(...place(M.coffeeMachine(), at(k.coffee.position[0], y + k.coffee.position[1], k.coffee.position[2], k.coffee.yaw)));
  parts.push(...place(M.diningTable(), at(k.table.position[0], y, k.table.position[2])));
  for (const c of k.chairs) parts.push(...place(M.simpleChair(), at(c.position[0], y, c.position[2], c.yaw)));
  parts.push(...place(M.pottedPlant(), at(k.plant[0], y, k.plant[2])));

  const p = partitionLayout(b);
  const h = DIM.partition.height;
  const t = 0.03;
  walls.push({
    key: `partition-${f.number}`,
    // No facing direction: an inner glass partition stays visible from every side instead of fading.
    normal: [0, 0],
    solidColor: PALETTE.steel,
    solid: p.segments.flatMap((seg) => [
      boxIn({ x0: p.x - 0.05, x1: p.x + 0.05, z0: seg.z0, z1: seg.z1 }, y + h - 0.06, y + h),
      boxIn({ x0: p.x - 0.05, x1: p.x + 0.05, z0: seg.z0, z1: seg.z1 }, y, y + 0.06),
    ]),
    glass: p.segments.map((seg) => boxIn({ x0: p.x - t, x1: p.x + t, z0: seg.z0, z1: seg.z1 }, y + 0.06, y + h - 0.06)),
  });
}

function officeZones(b: BuildingLayout, f: FloorLayout, opts: SceneOptions, parts: Part[], walls: Wall[], labels: LabelSpec[], picks: Pick[]) {
  const y = f.baseY;
  if (f.hasDirectorOffice) {
    const room = b.officeRoom;
    picks.push(directorPick(b, f));
    const o = officeFurniture(room);
    parts.push(flat({ x0: room.x0 + 0.2, x1: room.x1 - 0.2, z0: room.z0 + 0.2, z1: room.z1 - 0.2 }, y + 0.011, PALETTE.rug));
    parts.push(...place(M.workstation(true, true), at(o.desk.position[0], y, o.desk.position[2], o.desk.yaw)));
    parts.push(...place(M.diningTable(1.3, 1.3), at(o.meetingTable.position[0], y, o.meetingTable.position[2])));
    for (const c of o.meetingChairs) parts.push(...place(M.simpleChair(), at(c.position[0], y, c.position[2], c.yaw)));
    parts.push(...place(M.bookshelf(), at(o.shelf.position[0], y, o.shelf.position[2], o.shelf.yaw)));
    for (const p of o.plants) parts.push(...place(M.pottedPlant(), at(p[0], y, p[2])));
    walls.push(...glassRoom(room, o.doorGap, y, `office-${f.number}`));
    labels.push({ kind: "sign", key: `director-${f.number}`, position: [o.sign[0], y + o.sign[1], o.sign[2]], text: "DIRECTOR", size: 0.24, color: "#ffffff", board: PALETTE.accent, faceCamera: false });
  } else {
    const l = loungeLayout(b.sideZone);
    parts.push(...place(M.sofa(2.6), at(l.sofa.position[0], y, l.sofa.position[2], l.sofa.yaw)));
    parts.push(...place(M.lowTable(), at(l.table[0], y, l.table[2])));
    for (const p of l.plants) parts.push(...place(M.pottedPlant(), at(p[0], y, p[2])));
  }

  if (f.hasServerRoom) serverRoom(b, f, opts.serverBusy ?? false, parts, walls, labels, picks);
  else if (f.hasKitchen) kitchenWithPartition(b, f, parts, walls);
  else {
    const [kx, kz] = rectCenter(b.kitchenZone);
    for (const dz of [-1.5, 1.5]) parts.push(...place(M.pottedPlant(1.2), at(kx, y, kz + dz)));
  }
}

function receptionFloor(b: BuildingLayout, f: FloorLayout, parts: Part[], labels: LabelSpec[], liveStaff: boolean) {
  const y = f.baseY;
  const r = receptionLayout(b);
  parts.push(...place(M.receptionDesk(), at(r.desk.position[0], y, r.desk.position[2], r.desk.yaw)));
  for (const s of r.staff) {
    parts.push(...place(M.officeChair(PALETTE.dark), at(s.position[0], y, s.position[2], s.yaw)));
    if (!liveStaff) parts.push(...place(M.seatedPerson(PALETTE.uniform), at(s.position[0], y + s.position[1], s.position[2], s.yaw)));
  }
  for (const g of r.groups) {
    parts.push(flat(g.rug, y + 0.011, PALETTE.rug));
    parts.push(...place(M.sofa(), at(g.sofa.position[0], y, g.sofa.position[2], g.sofa.yaw)));
    for (const a of g.armchairs) parts.push(...place(M.armchair(), at(a.position[0], y, a.position[2], a.yaw)));
    parts.push(...place(M.lowTable(), at(g.table[0], y, g.table[2])));
    parts.push(...place(M.pottedPlant(1.1), at(g.plant[0], y, g.plant[2])));
  }
  for (const p of r.plants) parts.push(...place(M.pottedPlant(1.2), at(p[0], y, p[2])));
  labels.push({ kind: "sign", key: "reception", position: [r.sign[0], y + r.sign[1], r.sign[2]], text: "RECEPTION", size: 0.42, color: PALETTE.dark, faceCamera: true });
}

function coreStorey(b: BuildingLayout, f: FloorLayout, floor: FloorData, isTop: boolean, parts: Part[], walls: Wall[], labels: LabelSpec[]) {
  const core = coreLayout(b);
  const y = f.baseY;
  const h = storeyHeight(b, isTop);
  const { shaft, stairwell } = core;
  const [sx, sz] = rectCenter(shaft);
  const [sw, sd] = rectSize(shaft);
  const shaftH = h - DIM.slab;

  parts.push(cube([sx, y - DIM.slab / 2, sz], [sw + 0.3, DIM.slab, sd + 0.3], PALETTE.core));
  parts.push(cube([sx, y + shaftH / 2, sz], [sw, shaftH, sd], PALETTE.shaftGlass, "glass"));
  for (const x of [shaft.x0, shaft.x1]) for (const z of [shaft.z0, shaft.z1]) parts.push(cube([x, y + shaftH / 2, z], [0.1, shaftH, 0.1], PALETTE.steel));
  parts.push(cube([sx, y + 0.05, sz], [sw, 0.1, sd], PALETTE.steel));

  const o = elevatorOpening(b);
  const mid = (o.from + o.to) / 2;
  const ow = o.to - o.from;
  const dx = DIM.wall + 0.03;
  parts.push(cube([dx, y + 2.4, mid], [0.06, 0.2, ow + 0.3], PALETTE.steel));
  for (const s of [-1, 1]) parts.push(cube([dx, y + 1.15, mid + (s * (ow + 0.15)) / 2], [0.06, 2.3, 0.15], PALETTE.steel));

  if (isTop) {
    parts.push(boxPart(shift(boxIn({ ...stairwell, z0: stairwell.z1 - DIM.core.landing }, -DIM.slab, 0), y), PALETTE.core));
  } else {
    const s = stairStorey(stairwell, b.pitch);
    parts.push(...s.steps.map((x) => boxPart(shift(x, y), PALETTE.slabEdge)));
    parts.push(...s.landings.map((x) => boxPart(shift(x, y), PALETTE.core)));
    parts.push(...[...s.rails, ...s.posts].map((x) => boxPart(shift(x, y), PALETTE.steel)));
  }
  for (const w of core.walls) {
    walls.push({ key: `core-${f.number}-${w.key}`, normal: w.normal, solidColor: PALETTE.core, solid: [boxIn(w.box, y - DIM.slab, y + h - DIM.slab)], glass: [] });
  }
  labels.push({ kind: "floorSign", key: `floor-${floor.id}`, position: [core.sign[0], y + core.sign[1], core.sign[2]], number: floor.number, name: floor.name });
}

function entranceParts(e: EntranceLayout): Part[] {
  const [x, y, z] = e.door;
  const { w } = DIM.door;
  const h = DIM.floorHeight - DIM.slab;
  const fr = 0.14;
  const [rx, , rz] = e.reader;
  return [
    flat(e.walkway, 0.02, PALETTE.curb, "matte"),
    ...[-1, 1].map((s) => cube([x + (s * (w - fr)) / 2, y + h / 2, z], [fr, h, 0.24], PALETTE.dark)),
    cube([x, y + h - fr / 2, z], [w, fr, 0.24], PALETTE.dark),
    boxPart(e.canopy, PALETTE.slab),
    cube([x, e.canopy.position[1] - 0.1, z + DIM.canopy.d], [DIM.canopy.w, 0.06, 0.06], PALETTE.dark),
    cube([rx, 0.6, rz], [0.16, 1.2, 0.16], PALETTE.dark),
    cube([rx, 1.1, rz + 0.085], [0.14, 0.22, 0.02], PALETTE.metal),
    cube([rx, 1.17, rz + 0.098], [0.08, 0.03, 0.01], PALETTE.accent, "screen"),
  ];
}

function roadParts(site: SiteLayout): Part[] {
  const { main, cross, intersection } = site.roads;
  const parts: Part[] = [flat(main, 0.01, PALETTE.road), flat(cross, 0.012, PALETTE.road)];
  const dash = 2;
  const mz = (main.z0 + main.z1) / 2;
  const cx = (cross.x0 + cross.x1) / 2;
  for (let x = main.x0 + dash; x < main.x1 - dash; x += dash * 2) {
    if (x > intersection.x0 - 6 && x < intersection.x1 + 6) continue;
    parts.push(cube([x, 0.025, mz], [dash, 0.01, 0.16], PALETTE.roadLine, "decal"));
  }
  for (let z = cross.z0 + dash; z < cross.z1 - dash; z += dash * 2) {
    if (z > intersection.z0 - 6 && z < intersection.z1 + 6) continue;
    parts.push(cube([cx, 0.025, z], [0.16, 0.01, dash], PALETTE.roadLine, "decal"));
  }
  const zebra = (x0: number, x1: number, z0: number, z1: number, alongX: boolean) => {
    const count = 7;
    for (let i = 0; i < count; i++) {
      const k = (i + 0.5) / count;
      parts.push(
        alongX
          ? cube([x0 + (x1 - x0) * k, 0.026, (z0 + z1) / 2], [0.45, 0.01, z1 - z0], PALETTE.roadLine, "decal")
          : cube([(x0 + x1) / 2, 0.026, z0 + (z1 - z0) * k], [x1 - x0, 0.01, 0.45], PALETTE.roadLine, "decal"),
      );
    }
  };
  zebra(cross.x0, cross.x1, main.z0 - 3.4, main.z0 - 0.8, true);
  zebra(cross.x0, cross.x1, main.z1 + 0.8, main.z1 + 3.4, true);
  zebra(intersection.x0 - 3.4, intersection.x0 - 0.8, main.z0, main.z1, false);
  zebra(intersection.x1 + 0.8, intersection.x1 + 3.4, main.z0, main.z1, false);
  return parts;
}

function parkingParts(site: SiteLayout, labels: LabelSpec[]): Part[] {
  const { spotW, spotD } = DIM.parking;
  const lot = site.lot;
  const [lx, lz] = rectCenter(lot);
  const [lw, ld] = rectSize(lot);
  const parts: Part[] = [
    flat(lot, 0.015, PALETTE.asphalt),
    cube([lx, 0.07, lot.z0], [lw, 0.14, 0.25], PALETTE.curb),
    cube([lot.x1, 0.07, lz], [0.25, 0.14, ld], PALETTE.curb),
    boxPart(boxIn(site.island, 0, 0.16), PALETTE.curb),
  ];
  for (const spot of site.spots) {
    const [x, , z] = spot.center;
    const color = spot.kind === "director" ? PALETTE.accent : PALETTE.roadLine;
    for (const s of [-1, 1]) parts.push(cube([x + (s * spotW) / 2, 0.035, z], [0.09, 0.01, spotD], color, "decal"));
    if (spot.kind !== "desk") {
      const toAisle = spot.yaw === 0 ? 1 : -1;
      labels.push({
        kind: "ground",
        key: `spot-${spot.index}`,
        position: [x, 0.045, z + toAisle * (spotD / 2 - 0.8)],
        text: spot.kind === "director" ? "DIRECTOR" : "GUEST",
        size: 0.4,
        color: spot.kind === "director" ? PALETTE.accent : PALETTE.dark,
      });
    }
  }
  for (const a of site.arrows) {
    parts.push(...place([cube([0, 0.035, 0.6], [0.28, 0.01, 1.6], PALETTE.roadLine, "decal"), part("prism", [0, 0.035, -0.45], [1.2, 0.01, 1.1], PALETTE.roadLine, "decal", [0, Math.PI, 0])], at(a.position[0], 0, a.position[2], a.yaw)));
  }
  for (const b of site.barriers) parts.push(cube([b.post[0], 0.55, b.post[2]], [0.36, 1.1, 0.36], PALETTE.dark));
  for (const line of site.fence) {
    const [x0, z0] = line.from;
    const [x1, z1] = line.to;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len / DIM.fence.step));
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      parts.push(cube([x0 + (x1 - x0) * k, DIM.fence.height / 2, z0 + (z1 - z0) * k], [0.1, DIM.fence.height, 0.1], PALETTE.fence));
    }
    for (const ry of [0.45, DIM.fence.height - 0.08]) {
      parts.push(cube([(x0 + x1) / 2, ry, (z0 + z1) / 2], alongX ? [len, 0.05, 0.05] : [0.05, 0.05, len], PALETTE.fence));
    }
  }
  return parts;
}

function greeneryParts(items: ReturnType<typeof greenery>): Part[] {
  return items.flatMap((g) => {
    const model =
      g.kind === "conifer" ? M.conifer(g.variant) : g.kind === "deciduous" ? M.deciduous(g.variant) : g.kind === "bush" ? M.bush(g.variant) : M.flowerBed(g.variant);
    return model.map((p) => ({
      ...p,
      position: [g.position[0] + p.position[0] * g.scale, p.position[1] * g.scale, g.position[2] + p.position[2] * g.scale] as Vec3,
      scale: [p.scale[0] * g.scale, p.scale[1] * g.scale, p.scale[2] * g.scale] as Vec3,
    }));
  });
}

function roofParts(b: BuildingLayout): Part[] {
  const top = b.floors.at(-1);
  if (!top) return [];
  const r = roofLayout(b, top.baseY);
  return [
    boxPart(r.slab, PALETTE.roof),
    ...r.parapets.map((p) => boxPart(p, PALETTE.slab)),
    boxPart(r.coreCap, PALETTE.core),
    ...r.hvac.flatMap((h) => place(M.hvacUnit(), h)),
    ...r.ac.flatMap((a) => place(M.acUnit(), a)),
  ];
}

export function buildScene(floors: readonly FloorData[], visible: (floorNumber: number) => boolean, opts: SceneOptions = {}): SceneSpec {
  const building = buildingLayout(floors);
  const site = siteLayout(building);
  const entrance = entranceLayout(building, site.roads.main.z0);
  const byNumber = new Map(floors.map((f) => [f.number, f]));
  const parts: Part[] = [];
  const walls: Wall[] = [];
  const labels: LabelSpec[] = [];
  const picks: Pick[] = [];

  const shown = building.floors.filter((f) => visible(f.number));
  const topShown = shown.at(-1)?.number;
  for (const f of shown) {
    const floor = byNumber.get(f.number);
    if (!floor) continue;
    const isTop = f.number === topShown;
    parts.push(cube([building.width / 2, f.baseY - DIM.slab / 2, building.depth / 2], [building.width, DIM.slab, building.depth], PALETTE.slab));
    if (!isTop) {
      const span = building.pitch - DIM.slab;
      for (const [x, , z] of columnPositions(building)) parts.push(cube([x, f.baseY + span / 2, z], [0.2, span, 0.2], PALETTE.slabEdge));
    }
    walls.push(...floorWalls(building, f).map((w) => ({ ...w, solidColor: PALETTE.wall })));
    if (f.kind === "reception") receptionFloor(building, f, parts, labels, opts.liveStaff ?? false);
    else {
      workstations(floor, f, parts, labels, picks);
      officeZones(building, f, opts, parts, walls, labels, picks);
    }
    coreStorey(building, f, floor, isTop, parts, walls, labels);
  }
  if (building.floors.length > 0) parts.push(...entranceParts(entrance));

  parts.push(...roadParts(site), ...parkingParts(site, labels));
  picks.push(...site.spots.map(spotPick));
  for (const f of building.floors) {
    for (const a of byNumber.get(f.number)?.agents ?? []) {
      if (!a.carParked) continue;
      const spot = site.spots[site.deskSpot(f.index, a.deskIndex)];
      if (!spot) continue;
      parts.push(...place(M.car(carColor(a.roleKey)), { position: spot.center, yaw: spot.yaw }));
      labels.push({ kind: "tag", key: `car-${a.id}`, position: [spot.center[0], DIM.carTag.y, spot.center[2]], text: a.title, status: a.status, statusColor: a.statusColor });
    }
  }
  parts.push(...greeneryParts(greenery(building, site, entrance)));

  return { building, site, entrance, routes: routes(site), parts, walls, labels, roof: roofParts(building), picks, moving: movingSpec(building, site, entrance) };
}

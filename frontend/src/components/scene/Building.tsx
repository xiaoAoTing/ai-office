"use client";

import type { WorldState } from "@/lib/api";
import type { T } from "@/lib/i18n";
import { activityCaption, agentTag } from "@/lib/labels";
import { hashString } from "@/scene/palette";
import { type FloorData, type SceneSpec, presence } from "@/scene/layout";
import { useUiStore } from "@/store/useUiStore";
import { Batches } from "./parts/Batches";
import { Highlight } from "./parts/Highlight";
import { Picking } from "./parts/Picking";
import { Roof } from "./parts/Roof";
import { RoutesOverlay } from "./parts/RoutesOverlay";
import { SceneLabels } from "./parts/SceneLabels";
import { Walls } from "./parts/Walls";
import { inOffice, onTrip } from "./motion/Motion";
import { ScreenContents } from "./parts/ScreenContents";

/** `animated`: agents on an animated trip are left out of the static scene (the motion layer draws them). */
export function toFloorData(world: WorldState, preview: boolean, animated: boolean, living: boolean, t: T): FloorData[] {
  return world.floors.map((f) => ({
    id: f.id,
    number: f.number,
    name: f.name,
    kind: f.kind,
    capacity: f.capacity,
    has_director_office: f.has_director_office,
    has_server_room: f.has_server_room,
    has_kitchen: f.has_kitchen,
    agents: f.agents.map((a) => ({
      id: a.id,
      deskIndex: a.desk_index,
      roleKey: a.role_key,
      title: a.title,
      ...presence(a.status, preview, animated && onTrip(a), living && inOffice(a)),
      // With office life the desk plaque says what is really going on ("Writing a draft", "Reading gov.uk").
      status: (living && inOffice(a) ? activityCaption(t, a) : null) ?? agentTag(t, a).label,
      statusColor: agentTag(t, a).color,
      screenMode: preview
        ? (["working", "web", "review", "idle"] as const)[hashString(`preview:${a.id}`) % 4]
        : a.status === "working"
          ? a.current_task?.waiting_for_model || a.activity_log.at(-1)?.kind === "waiting_model"
            ? "loading"
            : a.current_task?.on_web || a.current_task?.web_step
              ? "web"
              : "working"
          : a.status === "waiting_review"
            ? "review"
            : a.status === "idle"
              ? "idle"
              : undefined,
    })),
  }));
}

export function Building({ scene, homeZoom, floors }: { scene: SceneSpec; homeZoom: number; floors: FloorData[] }) {
  const selected = useUiStore((s) => s.selectedFloor);
  const showRoutes = useUiStore((s) => s.routes);

  return (
    <group>
      <Batches parts={scene.parts} />
      <ScreenContents floors={scene.building.floors} agents={floors} selected={selected} />
      <Walls walls={scene.walls} />
      <SceneLabels labels={scene.labels} />
      <Picking picks={scene.picks} />
      <Highlight picks={scene.picks} />
      {selected === "all" && <Roof parts={scene.roof} homeZoom={homeZoom} />}
      {showRoutes && <RoutesOverlay routes={scene.routes} />}
    </group>
  );
}

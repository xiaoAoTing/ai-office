"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useState } from "react";
import { CanvasTexture, LinearFilter, MeshBasicMaterial, SRGBColorSpace } from "three";
import { hashString } from "@/scene/palette";
import { deskTransform, MONITOR_SCREEN, type AgentInput, type FloorLayout, type FloorData } from "@/scene/layout";
import { serverNow } from "../motion/Motion";

type ScreenBlock = { x: number; y: number; w: number; h: number; color: string; layer: 0 | 1 | 2; animate?: "cursor" | "progress" | "scroll"; seed?: number };
type Screen = { key: string; x: number; y: number; z: number; yaw: number; blocks: ScreenBlock[] };
type ScreenSurface = {
  screen: Screen;
  context: CanvasRenderingContext2D;
  texture: CanvasTexture;
  material: MeshBasicMaterial;
  animated: boolean;
};

// All UI is painted into one texture per monitor. The texture is the monitor's
// display face, so content can never become a stack of coplanar 3D rectangles.
const TEXTURE_WIDTH = 512;
const TEXTURE_HEIGHT = Math.round(TEXTURE_WIDTH * MONITOR_SCREEN.height / MONITOR_SCREEN.width);

const block = (x: number, y: number, w: number, h: number, color: string, layer: ScreenBlock["layer"], animate?: ScreenBlock["animate"], seed?: number): ScreenBlock => ({ x, y, w, h, color, layer, animate, seed });

function composition(mode: NonNullable<AgentInput["screenMode"]>, variant: number): ScreenBlock[] {
  const blocks: ScreenBlock[] = [];
  const add = (x: number, y: number, w: number, h: number, color: string, layer: ScreenBlock["layer"] = 1, animate?: ScreenBlock["animate"], seed?: number) => blocks.push(block(x, y, w, h, color, layer, animate, seed));
  const heading = (color: string) => add(0, 0.137, 0.58, 0.036, color, 1);
  if (mode === "web") {
    add(0, 0, MONITOR_SCREEN.width, MONITOR_SCREEN.height, "#edf5ed", 0); heading("#315e49");
    add(-0.218, -0.065, 0.105, 0.19, "#d8e5dc");
    add(0.04, 0.075, 0.32, 0.026, "#f8fbf8");
    add(0.04, 0.025, 0.32, 0.055, "#dcebdc");
    for (let i = 0; i < 12; i++) add(0.015 + (i % 4) * 0.055, -0.065 - Math.floor(i / 4) * 0.04, 0.038, 0.03, ["#8fca91", "#56a66a", "#b9ddb5", "#77b982"][(i + variant) % 4], 2, "scroll", i);
  } else if (mode === "working" || mode === "loading") {
    add(0, 0, MONITOR_SCREEN.width, MONITOR_SCREEN.height, "#dceefa", 0); heading("#2f6289");
    add(-0.195, 0.075, 0.09, 0.018, "#81a9c2");
    for (let i = 0; i < 4; i++) {
      const widths = [0.31, 0.38, 0.24, 0.34];
      add(-0.065, 0.035 - i * 0.044, widths[(i + variant) % widths.length], 0.018, ["#355e78", "#3b8c9b", "#bf8356", "#4875a0"][i], 2, "scroll", i);
    }
    if (mode === "loading") {
      add(0, -0.12, 0.36, 0.025, "#b8d5e7");
      add(-0.12, -0.12, 0.08, 0.017, "#398ab0", 2, "progress");
    } else {
      add(-0.195, -0.13, 0.022, 0.026, "#225f84", 2, "cursor");
      add(0, -0.13, 0.34, 0.018, "#9ab9cc", 2);
    }
  } else if (mode === "review") {
    add(0, 0, MONITOR_SCREEN.width, MONITOR_SCREEN.height, "#eee9f8", 0); heading("#67558c");
    add(-0.105, 0.065, 0.29, 0.052, "#c8b8e6");
    add(0.105, -0.012, 0.3, 0.052, "#ffffff");
    add(-0.105, -0.085, 0.29, 0.052, "#c8b8e6");
    add(0.04, -0.145, 0.055, 0.018, "#8b78b0", 2, "cursor");
    add(-0.105, 0.065, 0.19, 0.009, "#806da5", 2); add(0.105, -0.012, 0.2, 0.009, "#b2a4cf", 2);
  } else {
    const kind = variant % 3;
    if (kind === 0) {
      add(0, 0, MONITOR_SCREEN.width, MONITOR_SCREEN.height, "#f4dfcf", 0); heading("#bb6348");
      add(0, -0.035, 0.39, 0.17, "#6d554b"); add(0, -0.035, 0.052, 0.052, "#f3b16f", 2);
      add(-0.19, -0.138, 0.16, 0.012, "#cf9b82", 1); add(-0.105, -0.138, 0.13, 0.014, "#e99465", 2, "progress");
      add(0.19, -0.138, 0.055, 0.04, "#e88b66");
    } else if (kind === 1) {
      add(0, 0, MONITOR_SCREEN.width, MONITOR_SCREEN.height, "#f7ecd9", 0); heading("#a66d4f");
      for (let i = 0; i < 6; i++) {
        const x = -0.17 + (i % 3) * 0.17; const y = 0.045 - Math.floor(i / 3) * 0.11;
        add(x, y, 0.105, 0.075, ["#d9b987", "#c9d8c5", "#e3b5a2", "#adc5d1", "#e5d0a0", "#cfbedc"][(i + variant) % 6]);
      }
    } else {
      add(0, 0, MONITOR_SCREEN.width, MONITOR_SCREEN.height, "#dce9d4", 0); heading("#607b59");
      add(-0.08, -0.03, 0.24, 0.15, "#9dbd84"); add(0.08, -0.03, 0.08, 0.15, "#b6cf9b");
      add(-0.08, -0.03, 0.045, 0.05, "#daaa61", 2, "scroll", variant); add(0.2, -0.135, 0.25, 0.018, "#8ea77d", 2);
    }
  }
  return blocks.sort((a, b) => a.layer - b.layer);
}

function screensFor(floors: readonly FloorLayout[], agents: readonly FloorData[], selected: "all" | number): Screen[] {
  const screens: Screen[] = [];
  const floorByNumber = new Map(floors.map((floor) => [floor.number, floor]));
  for (const floorData of agents) {
    if (selected !== "all" && floorData.number !== selected) continue;
    const floor = floorByNumber.get(floorData.number);
    if (!floor) continue;
    for (const agent of floorData.agents) {
      if (!agent.atDesk || !agent.screenMode) continue;
      const [deskX, , deskZ] = deskTransform(agent.deskIndex).desk;
      for (const side of [-1, 1]) {
        const yaw = side < 0 ? 0.14 : -0.14;
        const monitorX = side * 0.34;
        const variant = hashString(`${agent.id}:${side}`);
        screens.push({
          key: `${floorData.number}:${agent.id}:${side}`,
          x: deskX + monitorX * Math.cos(yaw) + MONITOR_SCREEN.surfaceOffset * Math.sin(yaw),
          y: floor.baseY + 1.11,
          z: deskZ - monitorX * Math.sin(yaw) + MONITOR_SCREEN.surfaceOffset * Math.cos(yaw) - 0.28,
          yaw,
          blocks: composition(agent.screenMode, variant),
        });
      }
    }
  }
  return screens;
}

function paintScreen(surface: ScreenSurface, now: number) {
  const { context, screen } = surface;
  const scaleX = TEXTURE_WIDTH / MONITOR_SCREEN.width;
  const scaleY = TEXTURE_HEIGHT / MONITOR_SCREEN.height;
  context.clearRect(0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT);
  for (const item of screen.blocks) {
    const pulse = item.animate ? (Math.sin(now * 2.4 + (item.seed ?? 0) * 1.7) + 1) / 2 : 1;
    const color = item.animate === "cursor" && pulse < 0.48 ? "#c7dbeb" : item.color;
    const width = item.animate === "progress" ? item.w * (0.35 + pulse * 0.65) : item.w;
    const x = item.x + (item.w - width) / 2;
    const y = item.animate === "scroll" ? item.y + Math.sin(now * 1.8 + (item.seed ?? 0)) * 0.012 : item.y;
    const left = Math.round(TEXTURE_WIDTH / 2 + (x - width / 2) * scaleX);
    const top = Math.round(TEXTURE_HEIGHT / 2 - (y + item.h / 2) * scaleY);
    const right = Math.round(TEXTURE_WIDTH / 2 + (x + width / 2) * scaleX);
    const bottom = Math.round(TEXTURE_HEIGHT / 2 - (y - item.h / 2) * scaleY);
    context.fillStyle = color;
    context.fillRect(left, top, right - left, bottom - top);
  }
  surface.texture.needsUpdate = true;
}

function createSurface(screen: Screen): ScreenSurface | null {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_WIDTH;
  canvas.height = TEXTURE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const material = new MeshBasicMaterial({
    map: texture,
    toneMapped: false,
    depthWrite: false,
    // Bias only the depth value to win the coplanar test with the monitor frame.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const surface: ScreenSurface = { screen, context, texture, material, animated: screen.blocks.some((item) => item.animate !== undefined) };
  paintScreen(surface, serverNow());
  return surface;
}

export function ScreenContents({ floors, agents, selected }: { floors: readonly FloorLayout[]; agents: readonly FloorData[]; selected: "all" | number }) {
  const screens = useMemo(() => screensFor(floors, agents, selected), [floors, agents, selected]);
  const [surfaces, setSurfaces] = useState<ScreenSurface[]>([]);

  useLayoutEffect(() => {
    const next = screens.map(createSurface).filter((surface): surface is ScreenSurface => surface !== null);
    setSurfaces(next);
    return () => {
      for (const surface of next) {
        surface.material.dispose();
        surface.texture.dispose();
      }
    };
  }, [screens]);

  useFrame(() => {
    const now = serverNow();
    for (const surface of surfaces) {
      if (surface.animated) paintScreen(surface, now);
    }
  });

  return <>
    {surfaces.map((surface) => (
      <mesh
        key={surface.screen.key}
        position={[surface.screen.x, surface.screen.y, surface.screen.z]}
        rotation={[0, surface.screen.yaw, 0]}
        renderOrder={1}
      >
        <planeGeometry args={[MONITOR_SCREEN.width, MONITOR_SCREEN.height]} />
        <primitive object={surface.material} attach="material" />
      </mesh>
    ))}
  </>;
}

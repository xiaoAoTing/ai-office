"use client";

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, Color, Euler, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from "three";
import { hashString } from "@/scene/palette";
import { deskTransform, type AgentInput, type FloorLayout, type FloorData } from "@/scene/layout";
import { serverNow } from "../motion/Motion";

type ScreenBlock = { x: number; y: number; z: number; w: number; h: number; color: string; animate?: "cursor" | "progress" | "scroll"; seed?: number };
type Screen = { x: number; y: number; z: number; yaw: number; mode: NonNullable<AgentInput["screenMode"]>; variant: number };

const block = (x: number, y: number, w: number, h: number, color: string, animate?: ScreenBlock["animate"], seed?: number): ScreenBlock => ({ x, y, z: 0.008, w, h, color, animate, seed });

function composition(mode: Screen["mode"], variant: number): ScreenBlock[] {
  const blocks: ScreenBlock[] = [];
  const add = (x: number, y: number, w: number, h: number, color: string, animate?: ScreenBlock["animate"], seed?: number) => blocks.push(block(x, y, w, h, color, animate, seed));
  const heading = (color: string) => add(0, 0.137, 0.58, 0.036, color);
  if (mode === "web") {
    add(0, 0, 0.58, 0.33, "#edf5ed"); heading("#315e49");
    add(-0.218, -0.065, 0.105, 0.19, "#d8e5dc");
    add(0.04, 0.075, 0.32, 0.026, "#f8fbf8");
    add(0.04, 0.025, 0.32, 0.055, "#dcebdc");
    for (let i = 0; i < 12; i++) add(0.015 + (i % 4) * 0.055, -0.065 - Math.floor(i / 4) * 0.04, 0.038, 0.03, ["#8fca91", "#56a66a", "#b9ddb5", "#77b982"][(i + variant) % 4], "scroll", i);
  } else if (mode === "working" || mode === "loading") {
    add(0, 0, 0.58, 0.33, "#dceefa"); heading("#2f6289");
    add(-0.195, 0.075, 0.09, 0.018, "#81a9c2");
    for (let i = 0; i < 4; i++) {
      const widths = [0.31, 0.38, 0.24, 0.34];
      add(-0.065, 0.035 - i * 0.044, widths[(i + variant) % widths.length], 0.018, ["#355e78", "#3b8c9b", "#bf8356", "#4875a0"][i], "scroll", i);
    }
    if (mode === "loading") {
      add(0, -0.12, 0.36, 0.025, "#b8d5e7");
      add(-0.12, -0.12, 0.08, 0.017, "#398ab0", "progress");
    } else {
      add(-0.195, -0.13, 0.022, 0.026, "#225f84", "cursor");
      add(0, -0.13, 0.34, 0.018, "#9ab9cc");
    }
  } else if (mode === "review") {
    add(0, 0, 0.58, 0.33, "#eee9f8"); heading("#67558c");
    add(-0.105, 0.065, 0.29, 0.052, "#c8b8e6");
    add(0.105, -0.012, 0.3, 0.052, "#ffffff");
    add(-0.105, -0.085, 0.29, 0.052, "#c8b8e6");
    add(0.04, -0.145, 0.055, 0.018, "#8b78b0", "cursor");
    add(-0.105, 0.065, 0.19, 0.009, "#806da5"); add(0.105, -0.012, 0.2, 0.009, "#b2a4cf");
  } else {
    const kind = (variant % 3);
    if (kind === 0) {
      add(0, 0, 0.58, 0.33, "#f4dfcf"); heading("#bb6348");
      add(0, -0.035, 0.39, 0.17, "#6d554b"); add(0, -0.035, 0.052, 0.052, "#f3b16f");
      add(-0.19, -0.138, 0.16, 0.012, "#cf9b82"); add(-0.105, -0.138, 0.13, 0.014, "#e99465", "progress");
      add(0.19, -0.138, 0.055, 0.04, "#e88b66");
    } else if (kind === 1) {
      add(0, 0, 0.58, 0.33, "#f7ecd9"); heading("#a66d4f");
      for (let i = 0; i < 6; i++) {
        const x = -0.17 + (i % 3) * 0.17; const y = 0.045 - Math.floor(i / 3) * 0.11;
        add(x, y, 0.105, 0.075, ["#d9b987", "#c9d8c5", "#e3b5a2", "#adc5d1", "#e5d0a0", "#cfbedc"][(i + variant) % 6]);
      }
    } else {
      add(0, 0, 0.58, 0.33, "#dce9d4"); heading("#607b59");
      add(-0.08, -0.03, 0.24, 0.15, "#9dbd84"); add(0.08, -0.03, 0.08, 0.15, "#b6cf9b");
      add(-0.08, -0.03, 0.045, 0.05, "#daaa61", "scroll", variant); add(0.2, -0.135, 0.25, 0.018, "#8ea77d");
    }
  }
  return blocks.map((item, index) => ({ ...item, z: item.z + index * 0.00025 }));
}

function instances(floors: readonly FloorLayout[], agents: readonly FloorData[]) {
  const specs: { x: number; y: number; z: number; yaw: number; w: number; h: number; color: string; animate?: ScreenBlock["animate"]; seed: number }[] = [];
  const floorByNumber = new Map(floors.map((floor) => [floor.number, floor]));
  for (const floorData of agents) {
    const floor = floorByNumber.get(floorData.number);
    if (!floor) continue;
    for (const agent of floorData.agents) {
      if (!agent.atDesk || !agent.screenMode) continue;
      const [deskX, , deskZ] = deskTransform(agent.deskIndex).desk;
      for (const side of [-1, 1]) {
        const yaw = side < 0 ? 0.14 : -0.14;
        const monitorX = side * 0.34;
        const x = deskX + monitorX * Math.cos(yaw) + 0.022 * Math.sin(yaw);
        const z = deskZ - monitorX * Math.sin(yaw) + 0.022 * Math.cos(yaw) - 0.28;
        const screen: Screen = { x, y: floor.baseY + 1.11, z, yaw, mode: agent.screenMode, variant: hashString(`${agent.id}:${side}`) };
        for (const item of composition(screen.mode, screen.variant)) {
          const wx = screen.x + item.x * Math.cos(yaw) + item.z * Math.sin(yaw);
          const wz = screen.z - item.x * Math.sin(yaw) + item.z * Math.cos(yaw);
          specs.push({ x: wx, y: screen.y + item.y, z: wz, yaw, w: item.w, h: item.h, color: item.color, animate: item.animate, seed: item.seed ?? 0 });
        }
      }
    }
  }
  return specs;
}

export function ScreenContents({ floors, agents }: { floors: readonly FloorLayout[]; agents: readonly FloorData[] }) {
  const mesh = useRef<InstancedMesh>(null);
  const blocks = useMemo(() => instances(floors, agents), [floors, agents]);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 0.0015), []);
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), []);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (!target) return;
    const matrix = new Matrix4(); const quaternion = new Quaternion(); const euler = new Euler();
    const position = new Vector3(); const scale = new Vector3(); const color = new Color();
    blocks.forEach((item, index) => {
      euler.set(0, item.yaw, 0); quaternion.setFromEuler(euler);
      matrix.compose(position.set(item.x, item.y, item.z), quaternion, scale.set(item.w, item.h, 1));
      target.setMatrixAt(index, matrix); target.setColorAt(index, color.set(item.color));
    });
    target.count = blocks.length; target.instanceMatrix.needsUpdate = true;
    if (target.instanceColor) target.instanceColor.needsUpdate = true;
    target.computeBoundingSphere();
  }, [blocks]);

  useFrame(() => {
    const target = mesh.current;
    if (!target) return;
    const now = serverNow(); const matrix = new Matrix4(); const quaternion = new Quaternion(); const euler = new Euler();
    const position = new Vector3(); const scale = new Vector3(); const color = new Color();
    let changed = false;
    blocks.forEach((item, index) => {
      if (!item.animate) return;
      const pulse = (Math.sin(now * 2.4 + item.seed * 1.7) + 1) / 2;
      if (item.animate === "cursor" && pulse < 0.48) {
        target.setColorAt(index, color.set("#c7dbeb")); changed = true; return;
      }
      if (item.animate === "cursor") target.setColorAt(index, color.set(item.color));
      const width = item.animate === "progress" ? item.w * (0.35 + pulse * 0.65) : item.w;
      const y = item.animate === "scroll" ? item.y + Math.sin(now * 1.8 + item.seed) * 0.012 : item.y;
      euler.set(0, item.yaw, 0); quaternion.setFromEuler(euler);
      matrix.compose(position.set(item.x + (item.w - width) * Math.cos(item.yaw) / 2, y, item.z - (item.w - width) * Math.sin(item.yaw) / 2), quaternion, scale.set(width, item.h, 1));
      target.setMatrixAt(index, matrix); changed = true;
    });
    if (changed) { target.instanceMatrix.needsUpdate = true; if (target.instanceColor) target.instanceColor.needsUpdate = true; }
  });

  return <instancedMesh ref={mesh} args={[geometry, material, Math.max(1, blocks.length)]} frustumCulled={false} />;
}

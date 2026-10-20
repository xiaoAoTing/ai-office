"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useTasksStore } from "@/store/useTasksStore";
import { storedAnimation, storedCollapsed, storedFps, storedLife, useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";

export function WorldSync() {
  const startPolling = useWorldStore((s) => s.startPolling);
  const world = useWorldStore((s) => s.world);
  const refreshTasks = useTasksStore((s) => s.refresh);
  const setPreview = useUiStore((s) => s.setPreview);
  const setRoutes = useUiStore((s) => s.setRoutes);
  const params = useSearchParams();
  const preview = params.get("preview") === "1";
  const routes = params.get("routes") === "1";

  useEffect(() => startPolling(), [startPolling]);
  useEffect(
    () => useUiStore.setState({ animation: storedAnimation(), life: storedLife(), fps: storedFps(), collapsed: storedCollapsed() }),
    [],
  );
  useEffect(() => {
    if (world) void refreshTasks();
  }, [world, refreshTasks]);
  useEffect(() => setPreview(preview), [preview, setPreview]);
  useEffect(() => setRoutes(routes), [routes, setRoutes]);

  return null;
}

/**
 * 占位 panelStore（DEV-C 负责完整实现）
 */
import { create } from "zustand";
import type { PanelState } from "../types/terminal";

interface PanelStoreState {
  panels: Map<string, PanelState>;
  addPanel: (panel: PanelState) => void;
  updateCwd: (panelId: string, cwd: string) => void;
  setDead: (panelId: string, exitCode: number) => void;
  removePanel: (panelId: string) => void;
  clearAll: () => void;
}

export const usePanelStore = create<PanelStoreState>((set) => ({
  panels: new Map(),

  addPanel: (panel) =>
    set((state) => {
      const next = new Map(state.panels);
      next.set(panel.id, panel);
      return { panels: next };
    }),

  updateCwd: (panelId, cwd) =>
    set((state) => {
      const p = state.panels.get(panelId);
      if (!p) return state;
      const next = new Map(state.panels);
      next.set(panelId, { ...p, currentWorkingDirectory: cwd });
      return { panels: next };
    }),

  setDead: (panelId, exitCode) =>
    set((state) => {
      const p = state.panels.get(panelId);
      if (!p) return state;
      const next = new Map(state.panels);
      next.set(panelId, { ...p, isAlive: false, exitCode });
      return { panels: next };
    }),

  removePanel: (panelId) =>
    set((state) => {
      const next = new Map(state.panels);
      next.delete(panelId);
      return { panels: next };
    }),

  clearAll: () => set({ panels: new Map() }),
}));

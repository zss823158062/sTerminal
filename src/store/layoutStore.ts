/**
 * 占位 layoutStore（DEV-C 负责完整实现）
 * DEV-D 在此提供最小可用接口，确保 App.tsx 可以编译。
 */
import { create } from "zustand";
import type { LayoutNode } from "../types/layout";

interface LayoutStoreState {
  layoutTree: LayoutNode;
  focusPanelId: string | null;
  setLayoutTree: (tree: LayoutNode) => void;
  splitPanel: (panelId: string, direction: "horizontal" | "vertical") => void;
  closePanel: (panelId: string) => void;
  duplicatePanel: (panelId: string, direction: "horizontal" | "vertical") => void;
  setFocusPanel: (panelId: string | null) => void;
  countLeaves: () => number;
}

const DEFAULT_SHELL_PATH =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win")
    ? "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    : "/bin/bash";

const DEFAULT_SHELL_TYPE =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("win")
    ? "powershell"
    : "bash";

const initialTree: LayoutNode = {
  type: "terminal",
  id: crypto.randomUUID(),
  shellType: DEFAULT_SHELL_TYPE,
  shellPath: DEFAULT_SHELL_PATH,
  workingDirectory: "",
};

function countLeavesInTree(node: LayoutNode): number {
  if (node.type === "terminal") return 1;
  return countLeavesInTree(node.first) + countLeavesInTree(node.second);
}

export const useLayoutStore = create<LayoutStoreState>((set, get) => ({
  layoutTree: initialTree,
  focusPanelId: initialTree.id,

  setLayoutTree: (tree) => set({ layoutTree: tree }),

  splitPanel: (panelId, direction) => {
    set((state) => {
      const newLeaf: LayoutNode = {
        type: "terminal",
        id: crypto.randomUUID(),
        shellType: DEFAULT_SHELL_TYPE,
        shellPath: DEFAULT_SHELL_PATH,
        workingDirectory: "",
      };

      function insert(node: LayoutNode): LayoutNode {
        if (node.type === "terminal" && node.id === panelId) {
          return {
            type: "split",
            direction,
            ratio: 0.5,
            first: node,
            second: newLeaf,
          };
        }
        if (node.type === "split") {
          return { ...node, first: insert(node.first), second: insert(node.second) };
        }
        return node;
      }

      return { layoutTree: insert(state.layoutTree), focusPanelId: newLeaf.id };
    });
  },

  closePanel: (panelId) => {
    set((state) => {
      if (countLeavesInTree(state.layoutTree) <= 1) return state;

      function remove(node: LayoutNode): LayoutNode | null {
        if (node.type === "terminal") {
          return node.id === panelId ? null : node;
        }
        const first = remove(node.first);
        const second = remove(node.second);
        if (!first) return second;
        if (!second) return first;
        return { ...node, first, second };
      }

      const newTree = remove(state.layoutTree);
      if (!newTree) return state;
      return { layoutTree: newTree };
    });
  },

  duplicatePanel: (panelId, direction) => {
    set((state) => {
      const newId = crypto.randomUUID();

      function dup(node: LayoutNode): LayoutNode {
        if (node.type === "terminal" && node.id === panelId) {
          const newLeaf: LayoutNode = {
            type: "terminal",
            id: newId,
            shellType: node.shellType,
            shellPath: node.shellPath,
            workingDirectory: node.workingDirectory,
          };
          return {
            type: "split",
            direction,
            ratio: 0.5,
            first: node,
            second: newLeaf,
          };
        }
        if (node.type === "split") {
          return { ...node, first: dup(node.first), second: dup(node.second) };
        }
        return node;
      }

      return { layoutTree: dup(state.layoutTree), focusPanelId: newId };
    });
  },

  setFocusPanel: (panelId) => set({ focusPanelId: panelId }),

  countLeaves: () => countLeavesInTree(get().layoutTree),
}));

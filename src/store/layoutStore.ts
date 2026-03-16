import { create } from "zustand";
import type { LayoutNode, TerminalLeaf, TerminalSession } from "../types/layout";
import {
  insertNode,
  removeNode,
  updateRatio,
  duplicateNode,
  generateId,
  countLeaves,
  updateLeafInTree,
  collectLeaves,
  findLeafById,
  createSession,
} from "../utils/layoutTree";

/** 面板自动命名计数器 */
let panelNameCounter = 1;

/**
 * 创建初始单面板叶子节点（应用启动时的默认布局）
 */
function createInitialLeaf(): TerminalLeaf {
  const session = createSession(`控制台 ${panelNameCounter++}`);
  return {
    type: "terminal",
    id: generateId(),
    tabs: [session],
    activeTabId: session.id,
  };
}

interface LayoutState {
  /** 当前布局树 */
  layoutTree: LayoutNode;
  /** 当前获得焦点的面板 ID */
  focusedPanelId: string | null;
}

interface LayoutActions {
  /**
   * 在指定面板位置分割，创建新的 TerminalLeaf 插入树中。
   * 新面板自动获得焦点。
   */
  splitPanel: (
    panelId: string,
    direction: "horizontal" | "vertical",
    config?: Partial<Pick<TerminalSession, "shellType" | "shellPath" | "workingDirectory">>
  ) => string;

  /**
   * 关闭指定面板的活跃 tab；若是最后一个 tab，从树中移除 leaf（仅当面板数 > 1）。
   */
  closePanel: (panelId: string) => void;

  /**
   * 更新分割比例（拖拽分割线时调用）。
   */
  updateSplitRatio: (targetSplitFirstLeafId: string, newRatio: number) => void;

  /**
   * 复制面板：在指定面板旁按 direction 插入一个新面板。
   */
  duplicatePanel: (
    panelId: string,
    direction: "horizontal" | "vertical",
    config?: Partial<Pick<TerminalSession, "shellType" | "shellPath" | "workingDirectory">>
  ) => string;

  /**
   * 重命名 tab（遍历树找到包含该 tabId 的 leaf）
   */
  renamePanel: (tabId: string, name: string) => void;

  /**
   * 直接设置整棵布局树（布局加载时使用）
   */
  setLayoutTree: (tree: LayoutNode) => void;

  /**
   * 设置焦点面板
   */
  setFocusedPanel: (panelId: string | null) => void;

  /** 在指定 leaf 中新增一个 tab，自动激活，返回新 session ID */
  addTab: (
    leafId: string,
    config?: Partial<Pick<TerminalSession, "shellType" | "shellPath" | "workingDirectory">>
  ) => string;

  /** 关闭指定 tab；若最后一个则移除整个 leaf（仅当面板数 > 1） */
  closeTab: (leafId: string, tabId: string) => void;

  /** 切换指定 leaf 的活跃 tab */
  setActiveTab: (leafId: string, tabId: string) => void;
}

export type LayoutStore = LayoutState & LayoutActions;

export const useLayoutStore = create<LayoutStore>((set, get) => {
  const initialLeaf = createInitialLeaf();

  return {
    layoutTree: initialLeaf,
    focusedPanelId: initialLeaf.id,

    splitPanel(panelId, direction, config) {
      const session = createSession(`控制台 ${panelNameCounter++}`, config);
      const newLeaf: TerminalLeaf = {
        type: "terminal",
        id: generateId(),
        tabs: [session],
        activeTabId: session.id,
      };
      set((state) => ({
        layoutTree: insertNode(state.layoutTree, panelId, direction, newLeaf),
        focusedPanelId: newLeaf.id,
      }));
      return newLeaf.id;
    },

    closePanel(panelId) {
      const { layoutTree, focusedPanelId } = get();
      const leaf = findLeafById(layoutTree, panelId);
      if (!leaf) return;

      if (leaf.tabs.length <= 1) {
        // 最后一个 tab：移除整个 leaf（仅当不是最后一个面板时）
        if (countLeaves(layoutTree) <= 1) return;
        const newTree = removeNode(layoutTree, panelId);
        if (newTree === null) return;
        set({
          layoutTree: newTree,
          focusedPanelId: focusedPanelId === panelId ? null : focusedPanelId,
        });
      } else {
        // 关闭活跃 tab，切换到相邻 tab
        const activeIdx = leaf.tabs.findIndex((t) => t.id === leaf.activeTabId);
        const newTabs = leaf.tabs.filter((t) => t.id !== leaf.activeTabId);
        const newActiveIdx = Math.min(activeIdx, newTabs.length - 1);
        set((state) => ({
          layoutTree: updateLeafInTree(state.layoutTree, panelId, {
            tabs: newTabs,
            activeTabId: newTabs[newActiveIdx].id,
          }),
        }));
      }
    },

    updateSplitRatio(targetSplitFirstLeafId, newRatio) {
      set((state) => ({
        layoutTree: updateRatio(
          state.layoutTree,
          targetSplitFirstLeafId,
          newRatio
        ),
      }));
    },

    duplicatePanel(panelId, direction, config) {
      const session = createSession(`控制台 ${panelNameCounter++}`, config);
      const newLeaf: TerminalLeaf = {
        type: "terminal",
        id: generateId(),
        tabs: [session],
        activeTabId: session.id,
      };
      set((state) => ({
        layoutTree: duplicateNode(
          state.layoutTree,
          panelId,
          direction,
          newLeaf
        ),
        focusedPanelId: newLeaf.id,
      }));
      return newLeaf.id;
    },

    renamePanel(tabId, name) {
      set((state) => {
        const leaves = collectLeaves(state.layoutTree);
        const leaf = leaves.find((l) => l.tabs.some((t) => t.id === tabId));
        if (!leaf) return state;
        const newTabs = leaf.tabs.map((t) =>
          t.id === tabId ? { ...t, name } : t
        );
        return {
          layoutTree: updateLeafInTree(state.layoutTree, leaf.id, {
            tabs: newTabs,
          }),
        };
      });
    },

    setLayoutTree(tree) {
      set({ layoutTree: tree, focusedPanelId: null });
    },

    setFocusedPanel(panelId) {
      set({ focusedPanelId: panelId });
    },

    addTab(leafId, config) {
      const session = createSession(`控制台 ${panelNameCounter++}`, config);
      set((state) => {
        const leaf = findLeafById(state.layoutTree, leafId);
        if (!leaf) return state;
        return {
          layoutTree: updateLeafInTree(state.layoutTree, leafId, {
            tabs: [...leaf.tabs, session],
            activeTabId: session.id,
          }),
        };
      });
      return session.id;
    },

    closeTab(leafId, tabId) {
      const { layoutTree, focusedPanelId } = get();
      const leaf = findLeafById(layoutTree, leafId);
      if (!leaf) return;

      if (leaf.tabs.length <= 1) {
        // 最后一个 tab：移除整个 leaf
        if (countLeaves(layoutTree) <= 1) return;
        const newTree = removeNode(layoutTree, leafId);
        if (newTree === null) return;
        set({
          layoutTree: newTree,
          focusedPanelId: focusedPanelId === leafId ? null : focusedPanelId,
        });
      } else {
        const closedIdx = leaf.tabs.findIndex((t) => t.id === tabId);
        const newTabs = leaf.tabs.filter((t) => t.id !== tabId);
        let newActiveTabId = leaf.activeTabId;
        if (tabId === leaf.activeTabId) {
          const newIdx = Math.min(closedIdx, newTabs.length - 1);
          newActiveTabId = newTabs[newIdx].id;
        }
        set((state) => ({
          layoutTree: updateLeafInTree(state.layoutTree, leafId, {
            tabs: newTabs,
            activeTabId: newActiveTabId,
          }),
        }));
      }
    },

    setActiveTab(leafId, tabId) {
      set((state) => ({
        layoutTree: updateLeafInTree(state.layoutTree, leafId, {
          activeTabId: tabId,
        }),
      }));
    },
  };
});

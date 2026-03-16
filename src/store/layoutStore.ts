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
  /** 当前绑定的布局记录 ID（null 表示未绑定） */
  activeLayoutId: string | null;
  /** 当前绑定的布局名称（用于 TitleBar 显示） */
  activeLayoutName: string | null;
  /** 布局是否有未保存的修改 */
  layoutDirty: boolean;
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

  /** 绑定当前活跃布局 */
  setActiveLayout: (id: string, name: string) => void;

  /** 解绑活跃布局（新建空白布局时） */
  clearActiveLayout: () => void;

  /** 标记布局为已保存（清除 dirty 标记） */
  markLayoutClean: () => void;

  /** 在指定 leaf 中新增一个 tab，自动激活，返回新 session ID */
  addTab: (
    leafId: string,
    config?: Partial<Pick<TerminalSession, "shellType" | "shellPath" | "workingDirectory">>
  ) => string;

  /** 关闭指定 tab；若最后一个则移除整个 leaf（仅当面板数 > 1） */
  closeTab: (leafId: string, tabId: string) => void;

  /** 切换指定 leaf 的活跃 tab */
  setActiveTab: (leafId: string, tabId: string) => void;

  /** 移动 tab：同面板排序 / 跨面板合并 */
  moveTab: (
    fromLeafId: string,
    tabId: string,
    toLeafId: string,
    toIndex: number
  ) => void;

  /** 更新指定 tab 的配置（shell/目录/命令/名称） */
  updateTabConfig: (
    leafId: string,
    tabId: string,
    config: Partial<Omit<TerminalSession, "id">>
  ) => void;

  /** 移动 tab 到新分割面板 */
  moveTabToNewSplit: (
    fromLeafId: string,
    tabId: string,
    targetLeafId: string,
    direction: "horizontal" | "vertical",
    position: "before" | "after"
  ) => void;
}

export type LayoutStore = LayoutState & LayoutActions;

export const useLayoutStore = create<LayoutStore>((set, get) => {
  const initialLeaf = createInitialLeaf();

  return {
    layoutTree: initialLeaf,
    focusedPanelId: initialLeaf.id,
    activeLayoutId: null,
    activeLayoutName: null,
    layoutDirty: false,

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
        layoutDirty: true,
      }));
      return newLeaf.id;
    },

    closePanel(panelId) {
      const { layoutTree, focusedPanelId } = get();
      const leaf = findLeafById(layoutTree, panelId);
      if (!leaf) return;

      if (leaf.tabs.length <= 1) {
        if (countLeaves(layoutTree) <= 1) return;
        const newTree = removeNode(layoutTree, panelId);
        if (newTree === null) return;
        set({
          layoutTree: newTree,
          focusedPanelId: focusedPanelId === panelId ? null : focusedPanelId,
          layoutDirty: true,
        });
      } else {
        const activeIdx = leaf.tabs.findIndex((t) => t.id === leaf.activeTabId);
        const newTabs = leaf.tabs.filter((t) => t.id !== leaf.activeTabId);
        const newActiveIdx = Math.min(activeIdx, newTabs.length - 1);
        set((state) => ({
          layoutTree: updateLeafInTree(state.layoutTree, panelId, {
            tabs: newTabs,
            activeTabId: newTabs[newActiveIdx].id,
          }),
          layoutDirty: true,
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
        layoutDirty: true,
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
        layoutDirty: true,
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
          layoutDirty: true,
        };
      });
    },

    setLayoutTree(tree) {
      set({ layoutTree: tree, focusedPanelId: null, layoutDirty: false });
    },

    setFocusedPanel(panelId) {
      set({ focusedPanelId: panelId });
    },

    setActiveLayout(id, name) {
      set({ activeLayoutId: id, activeLayoutName: name });
    },

    clearActiveLayout() {
      set({ activeLayoutId: null, activeLayoutName: null });
    },

    markLayoutClean() {
      set({ layoutDirty: false });
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
          layoutDirty: true,
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
          layoutDirty: true,
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
          layoutDirty: true,
        }));
      }
    },

    setActiveTab(leafId, tabId) {
      set((state) => ({
        layoutTree: updateLeafInTree(state.layoutTree, leafId, {
          activeTabId: tabId,
        }),
        layoutDirty: true,
      }));
    },

    updateTabConfig(leafId, tabId, config) {
      set((state) => {
        const leaf = findLeafById(state.layoutTree, leafId);
        if (!leaf) return state;
        const newTabs = leaf.tabs.map((t) =>
          t.id === tabId ? { ...t, ...config } : t
        );
        return {
          layoutTree: updateLeafInTree(state.layoutTree, leafId, {
            tabs: newTabs,
          }),
          layoutDirty: true,
        };
      });
    },

    moveTab(fromLeafId, tabId, toLeafId, toIndex) {
      const { layoutTree, focusedPanelId } = get();
      const fromLeaf = findLeafById(layoutTree, fromLeafId);
      if (!fromLeaf) return;

      const tab = fromLeaf.tabs.find((t) => t.id === tabId);
      if (!tab) return;

      if (fromLeafId === toLeafId) {
        // 同面板排序
        const currentIdx = fromLeaf.tabs.findIndex((t) => t.id === tabId);
        if (currentIdx === toIndex || currentIdx === toIndex - 1) return; // no-op
        const newTabs = [...fromLeaf.tabs];
        newTabs.splice(currentIdx, 1);
        const insertIdx = toIndex > currentIdx ? toIndex - 1 : toIndex;
        newTabs.splice(insertIdx, 0, tab);
        set((state) => ({
          layoutTree: updateLeafInTree(state.layoutTree, fromLeafId, {
            tabs: newTabs,
          }),
          layoutDirty: true,
        }));
      } else {
        // 跨面板合并
        const toLeaf = findLeafById(layoutTree, toLeafId);
        if (!toLeaf) return;

        const fromTabs = fromLeaf.tabs.filter((t) => t.id !== tabId);
        let tree = layoutTree;

        if (fromTabs.length === 0) {
          // 源 leaf 空了，移除
          const newTree = removeNode(tree, fromLeafId);
          if (!newTree) return;
          tree = newTree;
        } else {
          // 更新源 leaf
          const newActiveId =
            fromLeaf.activeTabId === tabId
              ? fromTabs[Math.min(
                  fromLeaf.tabs.findIndex((t) => t.id === tabId),
                  fromTabs.length - 1
                )].id
              : fromLeaf.activeTabId;
          tree = updateLeafInTree(tree, fromLeafId, {
            tabs: fromTabs,
            activeTabId: newActiveId,
          });
        }

        // 插入到目标 leaf
        const newToTabs = [...toLeaf.tabs];
        const clampedIdx = Math.min(toIndex, newToTabs.length);
        newToTabs.splice(clampedIdx, 0, tab);
        tree = updateLeafInTree(tree, toLeafId, {
          tabs: newToTabs,
          activeTabId: tabId,
        });

        set({
          layoutTree: tree,
          focusedPanelId:
            focusedPanelId === fromLeafId && fromTabs.length === 0
              ? toLeafId
              : focusedPanelId,
          layoutDirty: true,
        });
      }
    },

    moveTabToNewSplit(fromLeafId, tabId, targetLeafId, direction, position) {
      const { layoutTree } = get();
      const fromLeaf = findLeafById(layoutTree, fromLeafId);
      if (!fromLeaf) return;

      // 守卫：拖同面板的唯一 tab 到自身边缘
      if (fromLeafId === targetLeafId && fromLeaf.tabs.length <= 1) return;

      const tab = fromLeaf.tabs.find((t) => t.id === tabId);
      if (!tab) return;

      // 创建新 leaf
      const newLeaf: TerminalLeaf = {
        type: "terminal",
        id: generateId(),
        tabs: [tab],
        activeTabId: tab.id,
      };

      let tree = layoutTree;

      // 从源 leaf 移除 tab
      const fromTabs = fromLeaf.tabs.filter((t) => t.id !== tabId);
      if (fromTabs.length === 0) {
        const newTree = removeNode(tree, fromLeafId);
        if (!newTree) return;
        tree = newTree;
      } else {
        const newActiveId =
          fromLeaf.activeTabId === tabId
            ? fromTabs[Math.min(
                fromLeaf.tabs.findIndex((t) => t.id === tabId),
                fromTabs.length - 1
              )].id
            : fromLeaf.activeTabId;
        tree = updateLeafInTree(tree, fromLeafId, {
          tabs: fromTabs,
          activeTabId: newActiveId,
        });
      }

      // 在目标位置插入新 split
      tree = insertNode(tree, targetLeafId, direction, newLeaf, position);

      set({
        layoutTree: tree,
        focusedPanelId: newLeaf.id,
        layoutDirty: true,
      });
    },
  };
});

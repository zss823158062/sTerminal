import { useState, useCallback } from "react";
import "./styles/global.css";
import "./styles/terminal.css";
import { TitleBar } from "./components/titlebar/TitleBar";
import { LayoutRenderer } from "./components/layout/LayoutRenderer";
import { SaveLayoutDialog } from "./components/layout-manager/SaveLayoutDialog";
import { LayoutManagerDrawer } from "./components/layout-manager/LayoutManagerDrawer";
import { Toast } from "./components/Toast";
import { useLayoutStore } from "./store/layoutStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { LayoutNode } from "./types/layout";

interface ToastState {
  id: number;
  message: string;
  type: "success" | "warning" | "error" | "info";
}

let toastCounter = 0;

export function App() {
  const layoutTree = useLayoutStore((s) => s.layoutTree);
  const setLayoutTree = useLayoutStore((s) => s.setLayoutTree);
  const splitPanel = useLayoutStore((s) => s.splitPanel);
  const closePanel = useLayoutStore((s) => s.closePanel);
  const duplicatePanel = useLayoutStore((s) => s.duplicatePanel);
  const focusPanelId = useLayoutStore((s) => s.focusPanelId);
  const setFocusPanel = useLayoutStore((s) => s.setFocusPanel);

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLayoutManager, setShowLayoutManager] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  // 布局名称递增计数
  const [layoutNameCounter, setLayoutNameCounter] = useState(1);

  const addToast = useCallback(
    (message: string, type: ToastState["type"] = "info") => {
      const id = ++toastCounter;
      setToasts((prev) => [...prev, { id, message, type }]);
    },
    []
  );

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleSaveSuccess = (_layoutId: string, name: string) => {
    setShowSaveDialog(false);
    setLayoutNameCounter((n) => n + 1);
    addToast(`布局已保存：${name}`, "success");
  };

  const handleLayoutLoad = (tree: LayoutNode) => {
    setLayoutTree(tree);
    addToast("布局已加载", "success");
  };

  const handleWorkdirWarning = (message: string) => {
    addToast(message, "warning");
  };

  // 快捷键：操作当前焦点面板
  useKeyboardShortcuts({
    onSplitHorizontal: () => {
      if (focusPanelId) splitPanel(focusPanelId, "horizontal");
    },
    onSplitVertical: () => {
      if (focusPanelId) splitPanel(focusPanelId, "vertical");
    },
    onDuplicate: () => {
      if (focusPanelId) duplicatePanel(focusPanelId, "horizontal");
    },
    onClose: () => {
      if (focusPanelId) closePanel(focusPanelId);
    },
    onSaveLayout: () => setShowSaveDialog(true),
    onOpenLayoutManager: () => setShowLayoutManager(true),
    onFocusNext: () => {
      // 简单实现：收集所有叶子节点 ID 并循环聚焦
      const leaves = collectLeaves(layoutTree);
      if (leaves.length === 0) return;
      const idx = focusPanelId ? leaves.indexOf(focusPanelId) : -1;
      setFocusPanel(leaves[(idx + 1) % leaves.length]);
    },
    onFocusPrev: () => {
      const leaves = collectLeaves(layoutTree);
      if (leaves.length === 0) return;
      const idx = focusPanelId ? leaves.indexOf(focusPanelId) : 0;
      setFocusPanel(leaves[(idx - 1 + leaves.length) % leaves.length]);
    },
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg-app)",
      }}
    >
      <TitleBar
        onOpenLayoutManager={() => setShowLayoutManager(true)}
        onSaveLayout={() => setShowSaveDialog(true)}
      />

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <LayoutRenderer node={layoutTree} />
      </div>

      {/* 保存布局弹窗 */}
      {showSaveDialog && (
        <SaveLayoutDialog
          defaultName={`布局 ${layoutNameCounter}`}
          tree={layoutTree}
          onSuccess={handleSaveSuccess}
          onCancel={() => setShowSaveDialog(false)}
        />
      )}

      {/* 布局管理抽屉 */}
      <LayoutManagerDrawer
        open={showLayoutManager}
        onClose={() => setShowLayoutManager(false)}
        onLayoutLoad={handleLayoutLoad}
        onWorkdirWarning={handleWorkdirWarning}
      />

      {/* Toast 通知 */}
      {toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onDismiss={() => removeToast(t.id)}
        />
      ))}
    </div>
  );
}

/** 递归收集布局树中所有叶子节点 ID */
function collectLeaves(node: LayoutNode): string[] {
  if (node.type === "terminal") return [node.id];
  return [...collectLeaves(node.first), ...collectLeaves(node.second)];
}

export default App;

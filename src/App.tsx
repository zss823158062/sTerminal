import { useState, useCallback } from "react";
import "./styles/global.css";
import "./styles/terminal.css";
import "./styles/tabbar.css";
import { TitleBar } from "./components/titlebar/TitleBar";
import { LayoutRenderer } from "./components/layout/LayoutRenderer";
import { SaveLayoutDialog } from "./components/layout-manager/SaveLayoutDialog";
import { LayoutManagerDrawer } from "./components/layout-manager/LayoutManagerDrawer";
import { Toast } from "./components/Toast";
import { useLayoutStore } from "./store/layoutStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { collectLeaves } from "./utils/layoutTree";
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
  const focusPanelId = useLayoutStore((s) => s.focusedPanelId);
  const setFocusPanel = useLayoutStore((s) => s.setFocusedPanel);

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
      const leafIds = collectLeaves(layoutTree).map((l) => l.id);
      if (leafIds.length === 0) return;
      const idx = focusPanelId ? leafIds.indexOf(focusPanelId) : -1;
      setFocusPanel(leafIds[(idx + 1) % leafIds.length]);
    },
    onFocusPrev: () => {
      const leafIds = collectLeaves(layoutTree).map((l) => l.id);
      if (leafIds.length === 0) return;
      const idx = focusPanelId ? leafIds.indexOf(focusPanelId) : 0;
      setFocusPanel(leafIds[(idx - 1 + leafIds.length) % leafIds.length]);
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

export default App;

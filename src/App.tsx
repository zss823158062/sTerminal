import { useState, useCallback, useEffect, useRef } from "react";
import "./styles/global.css";
import "./styles/terminal.css";
import "./styles/tabbar.css";
import { TitleBar } from "./components/titlebar/TitleBar";
import { LayoutRenderer } from "./components/layout/LayoutRenderer";
import { SaveLayoutDialog } from "./components/layout-manager/SaveLayoutDialog";
import { LayoutManagerDrawer } from "./components/layout-manager/LayoutManagerDrawer";
import { AppSettingsDialog } from "./components/settings/AppSettingsDialog";
import { CommandManagerDrawer } from "./components/commands/CommandManagerDrawer";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { Toast } from "./components/Toast";
import { useLayoutStore } from "./store/layoutStore";
import { useSettingsStore } from "./store/settingsStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { layoutUpdate } from "./ipc/layoutApi";
import { collectLeaves } from "./utils/layoutTree";
import { refitAll } from "./terminal/terminalInstances";
import { checkForUpdate, type UpdateInfo } from "./utils/updateChecker";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LayoutNode, AppSettings } from "./types/layout";

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
  const activeLayoutId = useLayoutStore((s) => s.activeLayoutId);
  const activeLayoutName = useLayoutStore((s) => s.activeLayoutName);
  const setActiveLayout = useLayoutStore((s) => s.setActiveLayout);
  const layoutDirty = useLayoutStore((s) => s.layoutDirty);
  const markLayoutClean = useLayoutStore((s) => s.markLayoutClean);

  const appSettings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLayoutManager, setShowLayoutManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandManager, setShowCommandManager] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  // 布局名称递增计数
  const [layoutNameCounter, setLayoutNameCounter] = useState(1);
  // 布局列表刷新触发器
  const [layoutRefreshKey, setLayoutRefreshKey] = useState(0);

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

  // 启动后延迟 3s 自动检查更新（静默：有更新弹窗，无更新/失败不提示）
  const autoCheckDone = useRef(false);
  useEffect(() => {
    if (autoCheckDone.current) return;
    autoCheckDone.current = true;
    const timer = setTimeout(async () => {
      const info = await checkForUpdate();
      if (info) {
        setUpdateInfo(info);
        setShowUpdateDialog(true);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // 手动检查更新（TitleBar 按钮）
  const handleCheckUpdate = useCallback(async () => {
    addToast("正在检查更新…", "info");
    const info = await checkForUpdate();
    if (info) {
      setUpdateInfo(info);
      setShowUpdateDialog(true);
    } else if (info === null) {
      addToast("当前已是最新版本", "success");
    }
  }, [addToast]);

  const handleSaveLayout = useCallback(async () => {
    if (activeLayoutId) {
      try {
        await layoutUpdate(activeLayoutId, layoutTree);
        markLayoutClean();
        addToast("布局已保存", "success");
      } catch (e) {
        addToast("保存失败：" + String(e), "error");
      }
    } else {
      setShowSaveDialog(true);
    }
  }, [activeLayoutId, layoutTree, addToast, markLayoutClean]);

  const handleSaveSuccess = (layoutId: string, name: string) => {
    setShowSaveDialog(false);
    setLayoutNameCounter((n) => n + 1);
    setActiveLayout(layoutId, name);
    markLayoutClean();
    setLayoutRefreshKey((n) => n + 1);
    addToast(`布局已保存：${name}`, "success");
  };

  const handleLayoutLoad = (tree: LayoutNode, layoutId: string, layoutName: string) => {
    setLayoutTree(tree);
    setActiveLayout(layoutId, layoutName);
    addToast("布局已加载", "success");
  };

  const handleWorkdirWarning = (message: string) => {
    addToast(message, "warning");
  };

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    // 弹窗关闭后刷新终端渲染位置
    requestAnimationFrame(() => refitAll());
  }, []);

  const handleSettingsSave = useCallback(
    async (newSettings: AppSettings) => {
      try {
        await updateSettings(newSettings);
        closeSettings();
        addToast("设置已保存", "success");
      } catch (e) {
        addToast("保存设置失败：" + String(e), "error");
      }
    },
    [updateSettings, closeSettings, addToast]
  );

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
    onSaveLayout: handleSaveLayout,
    onOpenLayoutManager: () => setShowLayoutManager(true),
    onOpenSettings: () => setShowSettings(true),
    onOpenCommandManager: () => setShowCommandManager(true),
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
        onOpenSettings={() => setShowSettings(true)}
        onOpenCommandManager={() => setShowCommandManager(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onCheckUpdate={handleCheckUpdate}
        activeLayoutName={activeLayoutName}
      />

      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <LayoutRenderer node={layoutTree} />
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <AppSettingsDialog
          settings={appSettings}
          onSave={handleSettingsSave}
          onCancel={closeSettings}
        />
      )}

      {/* 保存布局弹窗 */}
      {showSaveDialog && (
        <SaveLayoutDialog
          defaultName={`布局 ${layoutNameCounter}`}
          tree={layoutTree}
          onSuccess={handleSaveSuccess}
          onCancel={() => setShowSaveDialog(false)}
        />
      )}

      {/* 快捷键弹窗 */}
      {showShortcuts && (
        <KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} />
      )}

      {/* 常用命令管理抽屉 */}
      <CommandManagerDrawer
        open={showCommandManager}
        onClose={() => setShowCommandManager(false)}
      />

      {/* 布局管理抽屉 */}
      <LayoutManagerDrawer
        open={showLayoutManager}
        onClose={() => setShowLayoutManager(false)}
        onLayoutLoad={handleLayoutLoad}
        onWorkdirWarning={handleWorkdirWarning}
        onError={(msg) => addToast(msg, "error")}
        activeLayoutId={activeLayoutId}
        layoutDirty={layoutDirty}
        onSaveLayout={handleSaveLayout}
        onNewLayout={() => setShowSaveDialog(true)}
        refreshTrigger={layoutRefreshKey}
      />

      {/* 更新弹窗 */}
      {showUpdateDialog && updateInfo && (
        <ConfirmDialog
          title="发现新版本"
          message={`当前版本：v${updateInfo.currentVersion}\n最新版本：v${updateInfo.latestVersion}\n\n是否前往下载页面？`}
          kind="info"
          confirmText="前往下载"
          onConfirm={() => {
            setShowUpdateDialog(false);
            openUrl(updateInfo.releaseUrl);
          }}
          onCancel={() => setShowUpdateDialog(false)}
        />
      )}

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

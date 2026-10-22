import { useState, useCallback, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles/global.css";
import "./styles/terminal.css";
import "./styles/tabbar.css";
import { TitleBar } from "./components/titlebar/TitleBar";
import { LayoutRenderer } from "./components/layout/LayoutRenderer";
import { SaveLayoutDialog } from "./components/layout-manager/SaveLayoutDialog";
import { LayoutManagerDrawer } from "./components/layout-manager/LayoutManagerDrawer";
import { AppSettingsDialog } from "./components/settings/AppSettingsDialog";
import { CommandManagerDrawer } from "./components/commands/CommandManagerDrawer";
import { ClaudeSessionDialog } from "./components/claude/ClaudeSessionDialog";
import { KeyboardShortcutsDialog } from "./components/KeyboardShortcutsDialog";
import { UpdateDownloadDialog } from "./components/UpdateDownloadDialog";
import { Toast } from "./components/Toast";
import { useLayoutStore } from "./store/layoutStore";
import { useSettingsStore } from "./store/settingsStore";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { layoutUpdate } from "./ipc/layoutApi";
import { collectLeaves, findLeafById, rekeyLayoutTree } from "./utils/layoutTree";
import { openClaudeSessionInNewTab } from "./utils/claudeResume";
import {
  refitAll,
  getTerminal,
  installAtlasInvalidationListeners,
  rebuildAllAtlases,
} from "./terminal/terminalInstances";
import { terminalGetCwd, isElevated, restartAsAdmin } from "./ipc/terminalApi";
import { useConfirm } from "./hooks/useConfirm";
import { isWindows } from "./utils/platform";
import { installActivityTracking } from "./terminal/activity";
import { checkForUpdate, type UpdateInfo } from "./utils/updateChecker";
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
  /** Claude 会话弹窗的目标面板与其运行时 CWD；null 表示未打开 */
  const [claudeTarget, setClaudeTarget] = useState<{
    leafId: string;
    cwd: string;
  } | null>(null);

  /** 当前进程是否以管理员身份运行（仅 Windows 检测） */
  const [elevated, setElevated] = useState(false);
  const [confirm, ConfirmPortal] = useConfirm();

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

  // WebGL 纹理图集失效监听（窗口焦点/可见性/DPI 变化等尺寸不变的场景）
  useEffect(() => installAtlasInvalidationListeners(), []);

  // 后台活动标记 + 窗口失焦时的任务栏提醒
  useEffect(() => installActivityTracking(), []);

  // 同步窗口标题：任务栏缩略图 / Alt+Tab 中显示当前布局名
  useEffect(() => {
    const title = activeLayoutName
      ? `${activeLayoutName}${layoutDirty ? " *" : ""} - sTerminal`
      : "sTerminal";
    getCurrentWindow().setTitle(title);
  }, [activeLayoutName, layoutDirty]);

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
    // 重新生成整棵树的 leaf.id / session.id，避免与 terminalInstances 缓存中
    // 残留的脏实例撞 key，导致加载后终端无法输入 / Ctrl+C 无反应
    setLayoutTree(rekeyLayoutTree(tree));
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
      // 渲染器切换需要重建 xterm 实例，无法热生效
      const rendererChanged =
        (appSettings.gpuAcceleration !== false) !==
        (newSettings.gpuAcceleration !== false);
      try {
        await updateSettings(newSettings);
        closeSettings();
        if (rendererChanged) {
          addToast(
            newSettings.gpuAcceleration === false
              ? "已关闭 GPU 加速，新建终端生效"
              : "已开启 GPU 加速，新建终端生效",
            "info"
          );
        } else {
          addToast("设置已保存", "success");
        }
      } catch (e) {
        addToast("保存设置失败：" + String(e), "error");
      }
    },
    [updateSettings, closeSettings, addToast, appSettings.gpuAcceleration]
  );

  /** 获取焦点面板的运行时 CWD */
  const getFocusedCwd = useCallback(async () => {
    if (!focusPanelId) return "";
    const leaf = findLeafById(layoutTree, focusPanelId);
    if (!leaf) return "";
    const session = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];
    const managed = getTerminal(session.id);
    if (managed?.terminalId) {
      try { return await terminalGetCwd(managed.terminalId); } catch {}
    }
    return session.workingDirectory;
  }, [focusPanelId, layoutTree]);

  useEffect(() => {
    if (isWindows) isElevated().then(setElevated).catch(console.error);
  }, []);

  /** 以管理员身份重启：新实例从焦点面板的当前目录启动 */
  const handleRestartAsAdmin = useCallback(async () => {
    const ok = await confirm({
      title: "以管理员身份重新启动",
      message: layoutDirty
        ? "当前所有终端会话将关闭，且布局有未保存的修改。确认继续？"
        : "当前所有终端会话将关闭。确认继续？",
      confirmText: "重新启动",
      kind: "warning",
    });
    if (!ok) return;
    const cwd = await getFocusedCwd();
    // 成功时当前进程由后端直接退出，走到 catch 说明 UAC 被取消或启动失败
    restartAsAdmin(cwd || undefined).catch((e) => addToast(String(e), "warning"));
  }, [confirm, layoutDirty, getFocusedCwd, addToast]);

  /** TitleBar 入口：先定位焦点面板，再按其运行时 CWD 读取会话列表 */
  const handleOpenClaudeSessions = useCallback(async () => {
    if (!focusPanelId) {
      addToast("请先点击一个终端面板", "warning");
      return;
    }
    const cwd = await getFocusedCwd();
    if (!cwd) {
      addToast("无法解析当前面板的工作目录", "warning");
      return;
    }
    setClaudeTarget({ leafId: focusPanelId, cwd });
  }, [focusPanelId, getFocusedCwd, addToast]);

  const handleSelectClaudeSession = useCallback(
    (sessionId: string) => {
      if (!claudeTarget) return;
      const leaf = findLeafById(layoutTree, claudeTarget.leafId);
      const session = leaf
        ? leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0]
        : undefined;
      setClaudeTarget(null);
      const created = openClaudeSessionInNewTab(claudeTarget.leafId, sessionId, {
        workingDirectory: claudeTarget.cwd,
        shellType: session?.shellType,
        shellPath: session?.shellPath,
      });
      if (!created) addToast("会话 ID 格式异常，已取消", "error");
    },
    [claudeTarget, layoutTree, addToast]
  );

  // 快捷键：操作当前焦点面板
  useKeyboardShortcuts({
    onSplitHorizontal: async () => {
      if (!focusPanelId) return;
      const cwd = await getFocusedCwd();
      splitPanel(focusPanelId, "horizontal", { workingDirectory: cwd });
    },
    onSplitVertical: async () => {
      if (!focusPanelId) return;
      const cwd = await getFocusedCwd();
      splitPanel(focusPanelId, "vertical", { workingDirectory: cwd });
    },
    onDuplicate: async () => {
      if (!focusPanelId) return;
      const cwd = await getFocusedCwd();
      duplicatePanel(focusPanelId, "horizontal", { workingDirectory: cwd });
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
    onRedraw: rebuildAllAtlases,
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
        onOpenClaudeSessions={handleOpenClaudeSessions}
        activeLayoutName={activeLayoutName}
        isElevated={elevated}
        onRestartAsAdmin={isWindows ? handleRestartAsAdmin : undefined}
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

      {/* Claude 会话弹窗（TitleBar 入口，作用于焦点面板） */}
      {claudeTarget && (
        <ClaudeSessionDialog
          cwd={claudeTarget.cwd}
          onSelect={handleSelectClaudeSession}
          onClose={() => setClaudeTarget(null)}
        />
      )}

      {/* 更新弹窗 */}
      {showUpdateDialog && updateInfo && (
        <UpdateDownloadDialog
          updateInfo={updateInfo}
          onClose={() => setShowUpdateDialog(false)}
        />
      )}

      <ConfirmPortal />

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

import React, { useRef, useState, useCallback } from "react";
import type { TerminalLeaf, TerminalSession } from "../../types/layout";
import { useTerminal } from "../../hooks/useTerminal";
import { PaneTabBar } from "../TabBar";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { TerminalSettingsDialog } from "./TerminalSettingsDialog";
import { DropOverlay, type DropZone } from "../DropOverlay";
import { useLayoutStore } from "../../store/layoutStore";
import { countLeaves } from "../../utils/layoutTree";
import { destroyTerminal, getTerminal } from "../../terminal/terminalInstances";
import { terminalGetCwd } from "../../ipc/terminalApi";
import { getDragPayload, endDrag } from "../../utils/tabDragState";

const DRAG_MIME = "application/sterminal-tab";

interface TerminalPaneProps {
  leaf: TerminalLeaf;
}

interface ContextMenuState {
  x: number;
  y: number;
}

interface TerminalMethods {
  copySelection: () => void;
  pasteFromClipboard: () => void;
}

/** 单个终端会话组件：每个 session 拥有独立的 xterm + PTY */
const SingleTerminal: React.FC<{
  session: TerminalSession;
  active: boolean;
  onContextMenu: (e: React.MouseEvent, methods: TerminalMethods) => void;
}> = React.memo(({ session, active, onContextMenu }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const { isAlive, exitCode, restart, copySelection, pasteFromClipboard } =
    useTerminal({
      panelId: session.id,
      shellPath: session.shellPath,
      workingDirectory: session.workingDirectory,
      startupCommand: session.startupCommand,
      containerRef,
    });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e, { copySelection, pasteFromClipboard });
  };

  return (
    <div
      className="terminal-session"
      style={{
        display: active ? "flex" : "none",
        flex: 1,
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
      onContextMenu={handleContextMenu}
    >
      {/* host div 始终存在，避免 ref 丢失导致 acquire 失败 */}
      <div
        ref={containerRef}
        className="terminal-container"
        style={{
          flex: 1,
          overflow: "hidden",
          minHeight: 0,
          display: isAlive ? "block" : "none",
        }}
      />
      {!isAlive && (
        <div className="terminal-exit-overlay">
          <span className="exit-message">
            进程已退出（退出码 {exitCode ?? "未知"}）
          </span>
          <button className="restart-btn" onClick={restart}>
            重新启动
          </button>
        </div>
      )}
    </div>
  );
});

SingleTerminal.displayName = "SingleTerminal";

/**
 * 根据鼠标相对位置检测 drop zone
 * 边距 < 20% → 对应方向的分屏
 * 否则 → center（合并）
 */
function detectDropZone(
  clientX: number,
  clientY: number,
  rect: DOMRect
): DropZone {
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;

  const distLeft = relX;
  const distRight = 1 - relX;
  const distTop = relY;
  const distBottom = 1 - relY;

  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  if (minDist >= 0.2) return "center";
  if (minDist === distLeft) return "left";
  if (minDist === distRight) return "right";
  if (minDist === distTop) return "top";
  return "bottom";
}

/** zone → insertNode 参数映射 */
function zoneToSplitParams(zone: DropZone) {
  switch (zone) {
    case "left":
      return { direction: "horizontal" as const, position: "before" as const };
    case "right":
      return { direction: "horizontal" as const, position: "after" as const };
    case "top":
      return { direction: "vertical" as const, position: "before" as const };
    case "bottom":
      return { direction: "vertical" as const, position: "after" as const };
    default:
      return null;
  }
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ leaf }) => {
  const [contextMenu, setContextMenu] = useState<
    (ContextMenuState & TerminalMethods) | null
  >(null);
  const [showSettings, setShowSettings] = useState(false);
  const [dropZone, setDropZone] = useState<DropZone>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const paneRef = useRef<HTMLDivElement>(null);

  const layoutTree = useLayoutStore((s) => s.layoutTree);
  const splitPanel = useLayoutStore((s) => s.splitPanel);
  const closePanel = useLayoutStore((s) => s.closePanel);
  const duplicatePanel = useLayoutStore((s) => s.duplicatePanel);
  const updateTabConfig = useLayoutStore((s) => s.updateTabConfig);
  const moveTab = useLayoutStore((s) => s.moveTab);
  const moveTabToNewSplit = useLayoutStore((s) => s.moveTabToNewSplit);

  const panelCount = countLeaves(layoutTree);
  const isLastPanel = panelCount <= 1 && leaf.tabs.length <= 1;

  const activeSession = leaf.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf.tabs[0];

  const handleContextMenu = (
    e: React.MouseEvent,
    methods: TerminalMethods
  ) => {
    setContextMenu({ x: e.clientX, y: e.clientY, ...methods });
  };

  const handleSettingsApply = useCallback(
    (config: Partial<TerminalSession>) => {
      setShowSettings(false);
      if (Object.keys(config).length === 0) return;

      const tabId = activeSession.id;
      updateTabConfig(leaf.id, tabId, config);

      // 判断是否需要重建终端
      const needsRebuild =
        "shellPath" in config ||
        "shellType" in config ||
        "workingDirectory" in config ||
        "startupCommand" in config;

      if (needsRebuild) {
        destroyTerminal(tabId);
      }
    },
    [activeSession.id, leaf.id, updateTabConfig]
  );

  const handleDuplicate = useCallback(async () => {
    // 尝试获取终端运行时 cwd
    let cwd = activeSession.workingDirectory;
    const managed = getTerminal(activeSession.id);
    if (managed?.terminalId) {
      try {
        cwd = await terminalGetCwd(managed.terminalId);
      } catch {
        // 回退到 session 记录的初始目录
      }
    }
    duplicatePanel(leaf.id, "horizontal", {
      shellType: activeSession.shellType,
      shellPath: activeSession.shellPath,
      workingDirectory: cwd,
    });
  }, [activeSession, leaf.id, duplicatePanel]);

  // ── 面板级 drop zone ──

  const handlePaneDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;

      const payload = getDragPayload();
      if (!payload) return;

      // 守卫：拖唯一面板的唯一 tab
      if (
        payload.leafId === leaf.id &&
        leaf.tabs.length <= 1
      ) {
        return;
      }

      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setIsDragOver(true);

      if (!paneRef.current) return;
      const rect = paneRef.current.getBoundingClientRect();
      const zone = detectDropZone(e.clientX, e.clientY, rect);

      // 守卫：拖到同面板边缘且只有一个 tab → no-op
      if (
        payload.leafId === leaf.id &&
        leaf.tabs.length <= 1 &&
        zone !== "center"
      ) {
        setDropZone(null);
        return;
      }

      setDropZone(zone);
    },
    [leaf.id, leaf.tabs.length]
  );

  const handlePaneDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropZone(null);
      setIsDragOver(false);

      const payload = getDragPayload();
      if (!payload) return;

      if (!paneRef.current) return;
      const rect = paneRef.current.getBoundingClientRect();
      const zone = detectDropZone(e.clientX, e.clientY, rect);

      if (zone === "center") {
        // 合并到该面板
        moveTab(payload.leafId, payload.tabId, leaf.id, leaf.tabs.length);
      } else {
        const params = zoneToSplitParams(zone);
        if (params) {
          moveTabToNewSplit(
            payload.leafId,
            payload.tabId,
            leaf.id,
            params.direction,
            params.position
          );
        }
      }

      endDrag();
    },
    [leaf.id, leaf.tabs.length, moveTab, moveTabToNewSplit]
  );

  const handlePaneDragLeave = useCallback(
    (e: React.DragEvent) => {
      // 只在真正离开面板时清除
      if (
        paneRef.current &&
        !paneRef.current.contains(e.relatedTarget as Node)
      ) {
        setDropZone(null);
        setIsDragOver(false);
      }
    },
    []
  );

  return (
    <div
      ref={paneRef}
      className="terminal-pane"
      onDragOver={handlePaneDragOver}
      onDrop={handlePaneDrop}
      onDragLeave={handlePaneDragLeave}
    >
      <PaneTabBar leaf={leaf} />
      {leaf.tabs.map((session) => (
        <SingleTerminal
          key={session.id}
          session={session}
          active={session.id === leaf.activeTabId}
          onContextMenu={handleContextMenu}
        />
      ))}
      {/* 拖拽期间覆盖 xterm，防止 canvas 吞掉拖拽事件 */}
      {isDragOver && <div className="terminal-pane__drag-shield" />}
      <DropOverlay zone={dropZone} />
      {showSettings && (
        <TerminalSettingsDialog
          session={activeSession}
          onApply={handleSettingsApply}
          onCancel={() => setShowSettings(false)}
        />
      )}
      {contextMenu && (
        <TerminalContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          isLastPanel={isLastPanel}
          onCopy={contextMenu.copySelection}
          onPaste={contextMenu.pasteFromClipboard}
          onSplitHorizontal={() => splitPanel(leaf.id, "horizontal")}
          onSplitVertical={() => splitPanel(leaf.id, "vertical")}
          onDuplicate={handleDuplicate}
          onSettings={() => setShowSettings(true)}
          onClose={() => closePanel(leaf.id)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default TerminalPane;

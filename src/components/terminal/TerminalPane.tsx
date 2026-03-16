import React, { useRef, useState } from "react";
import type { TerminalLeaf, TerminalSession } from "../../types/layout";
import { useTerminal } from "../../hooks/useTerminal";
import { PaneTabBar } from "../TabBar";
import { TerminalContextMenu } from "./TerminalContextMenu";
import { useLayoutStore } from "../../store/layoutStore";
import { countLeaves } from "../../utils/layoutTree";

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
      {isAlive ? (
        <div
          ref={containerRef}
          className="terminal-container"
          style={{ flex: 1, overflow: "hidden", minHeight: 0 }}
        />
      ) : (
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

export const TerminalPane: React.FC<TerminalPaneProps> = ({ leaf }) => {
  const [contextMenu, setContextMenu] = useState<
    (ContextMenuState & TerminalMethods) | null
  >(null);

  const layoutTree = useLayoutStore((s) => s.layoutTree);
  const splitPanel = useLayoutStore((s) => s.splitPanel);
  const closePanel = useLayoutStore((s) => s.closePanel);
  const duplicatePanel = useLayoutStore((s) => s.duplicatePanel);

  const panelCount = countLeaves(layoutTree);
  const isLastPanel = panelCount <= 1 && leaf.tabs.length <= 1;

  const handleContextMenu = (
    e: React.MouseEvent,
    methods: TerminalMethods
  ) => {
    setContextMenu({ x: e.clientX, y: e.clientY, ...methods });
  };

  return (
    <div className="terminal-pane">
      <PaneTabBar leaf={leaf} />
      {leaf.tabs.map((session) => (
        <SingleTerminal
          key={session.id}
          session={session}
          active={session.id === leaf.activeTabId}
          onContextMenu={handleContextMenu}
        />
      ))}
      {contextMenu && (
        <TerminalContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          isLastPanel={isLastPanel}
          onCopy={contextMenu.copySelection}
          onPaste={contextMenu.pasteFromClipboard}
          onSplitHorizontal={() => splitPanel(leaf.id, "horizontal")}
          onSplitVertical={() => splitPanel(leaf.id, "vertical")}
          onDuplicate={() => duplicatePanel(leaf.id, "horizontal")}
          onClose={() => closePanel(leaf.id)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default TerminalPane;

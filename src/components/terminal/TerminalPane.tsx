import React, { useRef, useState } from "react";
import type { TerminalLeaf } from "../../types/layout";
import { useTerminal } from "../../hooks/useTerminal";
import { TerminalHeader } from "./TerminalHeader";
import { TerminalContextMenu } from "./TerminalContextMenu";

interface TerminalPaneProps {
  leaf: TerminalLeaf;
  /** 面板总数，用于判断关闭保护 */
  panelCount: number;
  onSplitHorizontal: (panelId: string) => void;
  onSplitVertical: (panelId: string) => void;
  onDuplicate: (panelId: string) => void;
  onClose: (panelId: string) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({
  leaf,
  panelCount,
  onSplitHorizontal,
  onSplitVertical,
  onDuplicate,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const { isAlive, exitCode, restart } = useTerminal({
    panelId: leaf.id,
    shellPath: leaf.shellPath,
    workingDirectory: leaf.workingDirectory,
    containerRef,
  });

  const isLastPanel = panelCount <= 1;

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="terminal-pane" onContextMenu={handleContextMenu}>
      <TerminalHeader
        shellType={leaf.shellType}
        workingDirectory={leaf.workingDirectory}
        isLastPanel={isLastPanel}
        onSplitHorizontal={() => onSplitHorizontal(leaf.id)}
        onSplitVertical={() => onSplitVertical(leaf.id)}
        onDuplicate={() => onDuplicate(leaf.id)}
        onClose={() => onClose(leaf.id)}
      />

      {/* xterm.js 容器 */}
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

      {contextMenu && (
        <TerminalContextMenu
          position={contextMenu}
          isLastPanel={isLastPanel}
          onSplitHorizontal={() => onSplitHorizontal(leaf.id)}
          onSplitVertical={() => onSplitVertical(leaf.id)}
          onDuplicate={() => onDuplicate(leaf.id)}
          onClose={() => onClose(leaf.id)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default TerminalPane;

import React, { useEffect, useRef } from "react";

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface TerminalContextMenuProps {
  position: ContextMenuPosition;
  isLastPanel: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onDuplicate: () => void;
  onSettings: () => void;
  onClose: () => void;
  onDismiss: () => void;
}

export const TerminalContextMenu: React.FC<TerminalContextMenuProps> = ({
  position,
  isLastPanel,
  onCopy,
  onPaste,
  onSplitHorizontal,
  onSplitVertical,
  onDuplicate,
  onSettings,
  onClose,
  onDismiss,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [onDismiss]);

  // 按 Escape 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  const handleAction = (action: () => void) => {
    action();
    onDismiss();
  };

  // 确保菜单不超出视口
  const style: React.CSSProperties = {
    left: position.x,
    top: position.y,
  };

  return (
    <div
      ref={menuRef}
      className="terminal-context-menu"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        className="terminal-context-menu__item"
        onClick={() => handleAction(onCopy)}
      >
        <span>复制</span>
        <span className="terminal-context-menu__shortcut">Ctrl+Shift+C</span>
      </button>
      <button
        className="terminal-context-menu__item"
        onClick={() => handleAction(onPaste)}
      >
        <span>粘贴</span>
        <span className="terminal-context-menu__shortcut">Ctrl+Shift+V</span>
      </button>
      <div className="terminal-context-menu__separator" />
      <button
        className="terminal-context-menu__item"
        onClick={() => handleAction(onSplitHorizontal)}
      >
        ⬌ 水平分割
      </button>
      <button
        className="terminal-context-menu__item"
        onClick={() => handleAction(onSplitVertical)}
      >
        ⬍ 垂直分割
      </button>
      <button
        className="terminal-context-menu__item"
        onClick={() => handleAction(onDuplicate)}
      >
        ⎘ 复制此面板
      </button>
      <div className="terminal-context-menu__separator" />
      <button
        className="terminal-context-menu__item"
        onClick={() => handleAction(onSettings)}
      >
        ⚙ 终端设置
      </button>
      <div className="terminal-context-menu__separator" />
      <button
        className="terminal-context-menu__item terminal-context-menu__item--danger"
        onClick={() => {
          if (isLastPanel) {
            if (!confirm("这是最后一个面板，确认关闭将退出应用，继续？")) {
              onDismiss();
              return;
            }
          }
          handleAction(onClose);
        }}
      >
        ✕ 关闭面板
      </button>
    </div>
  );
};

export default TerminalContextMenu;

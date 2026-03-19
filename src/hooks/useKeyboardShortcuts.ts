import { useEffect } from "react";

interface KeyboardShortcutHandlers {
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onDuplicate?: () => void;
  onClose?: () => void;
  onSaveLayout?: () => void;
  onOpenLayoutManager?: () => void;
  onOpenSettings?: () => void;
  onOpenCommandManager?: () => void;
  onFocusNext?: () => void;
  onFocusPrev?: () => void;
}

/**
 * 全局键盘快捷键绑定
 *
 * - Ctrl+Shift+H：水平分割当前焦点面板
 * - Ctrl+Shift+V：垂直分割当前焦点面板
 * - Ctrl+Shift+D：复制当前焦点面板
 * - Ctrl+Shift+W：关闭当前焦点面板
 * - Ctrl+Shift+S：保存当前布局
 * - Ctrl+Shift+L：打开布局管理
 * - Ctrl+Shift+P：打开常用命令管理
 * - Ctrl+,：打开设置
 * - Ctrl+Tab：聚焦下一面板
 * - Ctrl+Shift+Tab：聚焦上一面板
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey;
      const shift = e.shiftKey;
      const key = e.key.toUpperCase();

      if (ctrl && shift && key === "H") {
        e.preventDefault();
        handlers.onSplitHorizontal?.();
        return;
      }
      if (ctrl && shift && key === "V") {
        e.preventDefault();
        handlers.onSplitVertical?.();
        return;
      }
      if (ctrl && shift && key === "D") {
        e.preventDefault();
        handlers.onDuplicate?.();
        return;
      }
      if (ctrl && shift && key === "W") {
        e.preventDefault();
        handlers.onClose?.();
        return;
      }
      if (ctrl && shift && key === "S") {
        e.preventDefault();
        handlers.onSaveLayout?.();
        return;
      }
      if (ctrl && shift && key === "L") {
        e.preventDefault();
        handlers.onOpenLayoutManager?.();
        return;
      }
      if (ctrl && shift && key === "P") {
        e.preventDefault();
        handlers.onOpenCommandManager?.();
        return;
      }
      if (ctrl && !shift && e.key === ",") {
        e.preventDefault();
        handlers.onOpenSettings?.();
        return;
      }
      // Ctrl+Tab（无 Shift）
      if (ctrl && !shift && e.key === "Tab") {
        e.preventDefault();
        handlers.onFocusNext?.();
        return;
      }
      // Ctrl+Shift+Tab
      if (ctrl && shift && e.key === "Tab") {
        e.preventDefault();
        handlers.onFocusPrev?.();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}

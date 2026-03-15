import React from "react";
import { getShellIcon } from "../../utils/shellIcons";

interface TerminalHeaderProps {
  shellType: string;
  workingDirectory: string;
  /** 面板数量为 1 时关闭按钮禁用 */
  isLastPanel: boolean;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}

/** 缩略路径：超过 20 字符截断末尾 + "..." */
function truncatePath(path: string, maxLen = 20): string {
  // 只显示最后一段目录名
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const dirName = parts[parts.length - 1] ?? path;
  if (dirName.length <= maxLen) return dirName;
  return dirName.slice(0, maxLen) + "...";
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  shellType,
  workingDirectory,
  isLastPanel,
  onSplitHorizontal,
  onSplitVertical,
  onDuplicate,
  onClose,
}) => {
  const { icon, color } = getShellIcon(shellType);
  const dirLabel = truncatePath(workingDirectory);

  return (
    <div className="terminal-header">
      {/* Shell 图标 */}
      <span
        className="terminal-header__shell-icon"
        style={{ backgroundColor: color, color: "#fff" }}
        title={shellType}
      >
        {icon}
      </span>
      {/* Shell 类型名称 */}
      <span className="terminal-header__shell-type">{shellType}</span>
      {/* 当前目录 */}
      <span className="terminal-header__cwd" title={workingDirectory}>
        {dirLabel}
      </span>
      {/* 操作按钮 */}
      <div className="terminal-header__actions">
        <button
          className="terminal-header__btn"
          title="水平分割 (Ctrl+Shift+H)"
          onClick={onSplitHorizontal}
        >
          ⬌
        </button>
        <button
          className="terminal-header__btn"
          title="垂直分割 (Ctrl+Shift+V)"
          onClick={onSplitVertical}
        >
          ⬍
        </button>
        <button
          className="terminal-header__btn"
          title="复制面板 (Ctrl+Shift+D)"
          onClick={onDuplicate}
        >
          ⎘
        </button>
        <button
          className="terminal-header__btn terminal-header__btn--close"
          title={isLastPanel ? "最后一个面板，无法关闭" : "关闭面板 (Ctrl+Shift+W)"}
          onClick={() => {
            if (isLastPanel) {
              if (!confirm("这是最后一个面板，确认关闭将退出应用，继续？")) return;
            }
            onClose();
          }}
          disabled={false /* 允许点击触发确认逻辑 */}
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export default TerminalHeader;

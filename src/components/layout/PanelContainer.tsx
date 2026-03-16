import React from "react";
import type { TerminalLeaf } from "../../types/layout";
import { useLayoutStore } from "../../store/layoutStore";

interface PanelContainerProps {
  node: TerminalLeaf;
  /** DEV-D 的 TerminalPane 组件通过 children 插入 */
  children?: React.ReactNode;
}

/**
 * 叶子面板容器。
 * - 最小尺寸 80x80px
 * - 点击时设置焦点面板
 * - 焦点时边框高亮（var(--accent) 使用 --focus-ring 代替）
 * - 当前阶段渲染占位 div，DEV-D 接入 TerminalPane 后通过 children 插槽替换
 */
export function PanelContainer({ node, children }: PanelContainerProps) {
  const focusedPanelId = useLayoutStore((s) => s.focusedPanelId);
  const setFocusedPanel = useLayoutStore((s) => s.setFocusedPanel);

  const isFocused = focusedPanelId === node.id;

  const containerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    minWidth: "80px",
    minHeight: "80px",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "var(--bg-panel)",
    border: `1px solid ${isFocused ? "var(--focus-ring)" : "var(--border)"}`,
    boxSizing: "border-box",
    overflow: "hidden",
    position: "relative",
  };

  const placeholderStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-muted)",
    fontSize: "11px",
    fontFamily: "var(--font-mono)",
    gap: "4px",
    padding: "8px",
    userSelect: "none",
  };

  return (
    <div
      style={containerStyle}
      onClick={() => setFocusedPanel(node.id)}
    >
      {children ?? (
        <div style={placeholderStyle}>
          <span style={{ color: "var(--text-secondary)" }}>Panel</span>
          <span>{node.id.slice(0, 8)}</span>
          <span>{node.tabs.length} tab(s)</span>
        </div>
      )}
    </div>
  );
}

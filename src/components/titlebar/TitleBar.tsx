import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleBarProps {
  onOpenLayoutManager: () => void;
  activeLayoutName?: string | null;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  onOpenLayoutManager,
  activeLayoutName,
}) => {
  const win = getCurrentWindow();

  const handleMinimize = () => win.minimize().catch(console.error);
  const handleMaximize = () => win.toggleMaximize().catch(console.error);
  const handleClose = () => win.close().catch(console.error);

  return (
    <div style={titlebarStyle}>
      {/* 左侧：应用名 */}
      <div style={leftStyle}>
        <span style={appNameStyle}>sTerminal</span>
        {activeLayoutName && (
          <span style={layoutNameStyle}>「{activeLayoutName}」</span>
        )}
      </div>

      {/* 中间：拖拽区域 */}
      <div
        style={dragRegionStyle}
        data-tauri-drag-region="true"
      />

      {/* 右侧：按钮区 */}
      <div style={rightStyle}>
        <button
          style={actionBtnStyle}
          onClick={onOpenLayoutManager}
          title="布局管理 (Ctrl+Shift+L)"
        >
          布局
        </button>

        <div style={separatorStyle} />

        {/* 窗口控制按钮 */}
        <button
          style={{ ...winBtnStyle }}
          onClick={handleMinimize}
          title="最小化"
        >
          ─
        </button>
        <button
          style={{ ...winBtnStyle }}
          onClick={handleMaximize}
          title="最大化/还原"
        >
          □
        </button>
        <button
          style={{ ...winBtnStyle, ...closeBtnStyle }}
          onClick={handleClose}
          title="关闭"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

const titlebarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "var(--titlebar-height, 36px)",
  background: "var(--bg-titlebar, #141414)",
  borderBottom: "1px solid var(--border, #333)",
  flexShrink: 0,
  userSelect: "none",
};

const leftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  paddingLeft: 12,
  flexShrink: 0,
};

const appNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary, #e0e0e0)",
  letterSpacing: "0.5px",
};

const layoutNameStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted, #666)",
  marginLeft: 8,
};

const dragRegionStyle: React.CSSProperties = {
  flex: 1,
  height: "100%",
};

const rightStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  gap: 0,
};

const actionBtnStyle: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  fontSize: 12,
  background: "transparent",
  color: "var(--text-secondary, #999)",
  borderRadius: 3,
  margin: "0 2px",
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  background: "var(--border, #333)",
  margin: "0 4px",
};

const winBtnStyle: React.CSSProperties = {
  width: 46,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: "var(--text-secondary, #999)",
  borderRadius: 0,
  fontSize: 12,
  padding: 0,
};

const closeBtnStyle: React.CSSProperties = {
  color: "var(--text-muted, #666)",
};

export default TitleBar;

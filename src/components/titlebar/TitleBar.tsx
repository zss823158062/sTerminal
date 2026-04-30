import React, { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { isMacOS, isWindows } from "../../utils/platform";

interface TitleBarProps {
  onOpenLayoutManager: () => void;
  onOpenSettings: () => void;
  onOpenCommandManager: () => void;
  onOpenShortcuts: () => void;
  onCheckUpdate: () => void;
  activeLayoutName?: string | null;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  onOpenLayoutManager,
  onOpenSettings,
  onOpenCommandManager,
  onOpenShortcuts,
  onCheckUpdate,
  activeLayoutName,
}) => {
  const win = getCurrentWindow();
  const [version, setVersion] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setIsMaximized).catch(() => {});
    win.onResized(() => {
      win.isMaximized().then(setIsMaximized).catch(() => {});
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [win]);

  const handleMinimize = () => win.minimize().catch(console.error);
  const handleMaximize = () => win.toggleMaximize().catch(console.error);
  const handleClose = () => win.close().catch(console.error);

  // 右键标题栏：阻止 WebView2 默认菜单；Windows 下弹出原生系统菜单
  const handleTitlebarContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isWindows) {
      invoke("show_system_menu", { x: e.clientX, y: e.clientY }).catch(console.error);
    }
  };

  return (
    <div style={titlebarStyle} onContextMenu={handleTitlebarContextMenu}>
      {/* 左侧：应用名 */}
      <div style={leftStyle}>
        <span style={appNameStyle}>sTerminal</span>
        {version && <span style={versionStyle}>v{version}</span>}
        {activeLayoutName && (
          <span style={layoutNameStyle}>「{activeLayoutName}」</span>
        )}
      </div>

      {/* 中间：拖拽区域 */}
      <div
        style={dragRegionStyle}
        data-tauri-drag-region="true"
        onContextMenu={handleTitlebarContextMenu}
      />

      {/* 右侧：按钮区 */}
      <div style={rightStyle}>
        <button
          style={actionBtnStyle}
          onClick={onOpenSettings}
          title="设置 (Ctrl+,)"
        >
          设置
        </button>
        <button
          style={actionBtnStyle}
          onClick={onOpenCommandManager}
          title="常用命令 (Ctrl+Shift+P)"
        >
          命令
        </button>
        <button
          style={actionBtnStyle}
          onClick={onOpenLayoutManager}
          title="布局管理 (Ctrl+Shift+L)"
        >
          布局
        </button>

        <button
          style={iconBtnStyle}
          onClick={onOpenShortcuts}
          title="快捷键"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="6" y1="8" x2="6" y2="8" />
            <line x1="10" y1="8" x2="10" y2="8" />
            <line x1="14" y1="8" x2="14" y2="8" />
            <line x1="18" y1="8" x2="18" y2="8" />
            <line x1="6" y1="12" x2="6" y2="12" />
            <line x1="10" y1="12" x2="10" y2="12" />
            <line x1="14" y1="12" x2="14" y2="12" />
            <line x1="18" y1="12" x2="18" y2="12" />
            <line x1="8" y1="16" x2="16" y2="16" />
          </svg>
        </button>

        <button
          style={iconBtnStyle}
          onClick={onCheckUpdate}
          title="检查更新"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>

        <button
          style={iconBtnStyle}
          onClick={() => openUrl("https://github.com/zss823158062/sTerminal")}
          title="GitHub"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </button>

        {/* 窗口控制按钮 - macOS 使用原生红绿灯，无需自定义按钮 */}
        {!isMacOS && (
          <div style={winBtnGroupStyle}>
            <button
              className="win-btn"
              onClick={handleMinimize}
              title="最小化"
              aria-label="最小化"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges">
                <path d="M0 5 H10" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            </button>
            <button
              className="win-btn"
              onClick={handleMaximize}
              title={isMaximized ? "还原" : "最大化"}
              aria-label={isMaximized ? "还原" : "最大化"}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges">
                  <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
                  <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="var(--bg-titlebar, #141414)" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges">
                  <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
                </svg>
              )}
            </button>
            <button
              className="win-btn win-btn--close"
              onClick={handleClose}
              title="关闭"
              aria-label="关闭"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="square" />
              </svg>
            </button>
          </div>
        )}
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
  // macOS: 为原生红绿灯按钮预留左侧空间
  paddingLeft: isMacOS ? 70 : 0,
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

const versionStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted, #666)",
  marginLeft: 6,
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

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  background: "transparent",
  color: "var(--text-secondary, #999)",
  borderRadius: 3,
  margin: "0 2px",
  cursor: "pointer",
};

const winBtnGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  height: "100%",
  marginLeft: 8,
};

export default TitleBar;

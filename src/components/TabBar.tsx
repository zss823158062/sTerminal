import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../store/layoutStore";
import { useSettingsStore } from "../store/settingsStore";
import { useActivityStore } from "../store/activityStore";
import type { TerminalLeaf } from "../types/layout";
import {
  startDrag,
  endDrag,
  getDragPayload,
} from "../utils/tabDragState";
import { getTerminal } from "../terminal/terminalInstances";
import { terminalGetCwd } from "../ipc/terminalApi";
import { hasProxyUrl, normalizeProxyUrl } from "../utils/proxyEnv";
import { TabContextMenu } from "./TabContextMenu";

const DRAG_MIME = "application/sterminal-tab";

interface PaneTabBarProps {
  leaf: TerminalLeaf;
}

/**
 * 面板级标签栏：渲染 leaf 中所有 tab，支持切换、新增、关闭、重命名、拖拽排序/合并。
 */
export function PaneTabBar({ leaf }: PaneTabBarProps) {
  const addTab = useLayoutStore((s) => s.addTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const renamePanel = useLayoutStore((s) => s.renamePanel);
  const moveTab = useLayoutStore((s) => s.moveTab);
  const settings = useSettingsStore((s) => s.settings);
  const unread = useActivityStore((s) => s.unread);
  const clearUnread = useActivityStore((s) => s.clearUnread);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // 拖拽插入指示线位置（tab 索引，null 表示不显示）
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

  // 切到该 tab 即视为已读
  useEffect(() => {
    clearUnread(leaf.activeTabId);
  }, [leaf.id, leaf.activeTabId, clearUnread]);

  const commitRename = useCallback(() => {
    if (editingTabId && editValue.trim()) {
      renamePanel(editingTabId, editValue.trim());
    }
    setEditingTabId(null);
  }, [editingTabId, editValue, renamePanel]);

  const handleDoubleClick = (tabId: string, currentName: string) => {
    setEditValue(currentName);
    setEditingTabId(tabId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      commitRename();
    } else if (e.key === "Escape") {
      setEditingTabId(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent, tabId: string) => {
    // 鼠标中键关闭 tab
    if (e.button === 1) {
      e.preventDefault();
      closeTab(leaf.id, tabId);
    }
  };

  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveTab(leaf.id, tabId);
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  /** 获取目标 tab 的运行时 CWD */
  const getTabCwd = useCallback(async (tabId: string): Promise<string | undefined> => {
    const tab = leaf.tabs.find((t) => t.id === tabId);
    if (!tab) return undefined;
    let cwd = tab.workingDirectory;
    const managed = getTerminal(tab.id);
    if (managed?.terminalId) {
      try {
        cwd = await terminalGetCwd(managed.terminalId);
      } catch {
        // 回退到初始目录
      }
    }
    return cwd;
  }, [leaf.tabs]);

  const handleDuplicateTab = useCallback(async (tabId: string) => {
    const tab = leaf.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const cwd = await getTabCwd(tabId);
    addTab(leaf.id, {
      shellType: tab.shellType,
      shellPath: tab.shellPath,
      workingDirectory: cwd,
    });
  }, [leaf.id, leaf.tabs, addTab, getTabCwd]);

  const handleOpenInNewWindow = useCallback(async (tabId: string) => {
    const cwd = await getTabCwd(tabId);
    invoke("spawn_new_window", { cwd }).catch(console.error);
  }, [getTabCwd]);

  // ── 代理状态展示（开关在控制台设置面板里，这里只读）──

  const proxyConfigured = hasProxyUrl(settings);

  /** 代理标记的悬停说明：区分"生效中"和"开了但没配地址" */
  const proxyBadgeTitle = proxyConfigured
    ? `代理已开启：${normalizeProxyUrl(settings.proxyUrl ?? "")}`
    : "已开启代理，但未配置代理地址（请在设置中填写）";

  // ── Drag source ──

  const handleDragStart = (
    e: React.DragEvent,
    tabId: string,
    tabIndex: number
  ) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ leafId: leaf.id, tabId, tabIndex }));
    e.dataTransfer.effectAllowed = "move";
    startDrag({ leafId: leaf.id, tabId, tabIndex });
  };

  const handleDragEnd = () => {
    endDrag();
    setDropIndicatorIndex(null);
  };

  // ── Drop zone (tab bar) ──

  /** 根据鼠标 X 位置计算插入索引 */
  const calcInsertIndex = (clientX: number): number => {
    const container = tabsContainerRef.current;
    if (!container) return 0;
    const tabEls = container.querySelectorAll<HTMLElement>(".tabbar__tab");
    for (let i = 0; i < tabEls.length; i++) {
      const rect = tabEls[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (clientX < midX) return i;
    }
    return tabEls.length;
  };

  const handleContainerDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const idx = calcInsertIndex(e.clientX);
    setDropIndicatorIndex(idx);
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到 TerminalPane 的 drop handler
    setDropIndicatorIndex(null);

    const payload = getDragPayload();
    if (!payload) return;

    const idx = calcInsertIndex(e.clientX);
    moveTab(payload.leafId, payload.tabId, leaf.id, idx);
    endDrag();
  };

  const handleContainerDragLeave = (e: React.DragEvent) => {
    // 只在真正离开容器时清除（忽略子元素触发的 dragLeave）
    if (
      tabsContainerRef.current &&
      !tabsContainerRef.current.contains(e.relatedTarget as Node)
    ) {
      setDropIndicatorIndex(null);
    }
  };

  /** 计算指示线的 left 位置 */
  const calcIndicatorLeft = (): number => {
    if (dropIndicatorIndex == null || !tabsContainerRef.current) return 0;
    const tabEls =
      tabsContainerRef.current.querySelectorAll<HTMLElement>(".tabbar__tab");
    if (tabEls.length === 0) return 0;
    if (dropIndicatorIndex >= tabEls.length) {
      const lastRect = tabEls[tabEls.length - 1].getBoundingClientRect();
      const containerRect = tabsContainerRef.current.getBoundingClientRect();
      return lastRect.right - containerRect.left;
    }
    const targetRect = tabEls[dropIndicatorIndex].getBoundingClientRect();
    const containerRect = tabsContainerRef.current.getBoundingClientRect();
    return targetRect.left - containerRect.left;
  };

  return (
    <div className="tabbar" onContextMenu={(e) => e.preventDefault()}>
      <div
        ref={tabsContainerRef}
        className="tabbar__tabs"
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
        onDragLeave={handleContainerDragLeave}
      >
        {leaf.tabs.map((tab, index) => {
          const isActive = tab.id === leaf.activeTabId;
          const isEditing = editingTabId === tab.id;
          const payload = getDragPayload();
          const isDragging = payload?.tabId === tab.id;

          return (
            <div
              key={tab.id}
              className={`tabbar__tab ${isActive ? "tabbar__tab--active" : ""} ${isDragging ? "tabbar__tab--dragging" : ""}`}
              draggable={!isEditing}
              onDragStart={(e) => handleDragStart(e, tab.id, index)}
              onDragEnd={handleDragEnd}
              onClick={() => setActiveTab(leaf.id, tab.id)}
              onDoubleClick={() =>
                handleDoubleClick(tab.id, tab.name ?? "控制台")
              }
              onMouseDown={(e) => handleMouseDown(e, tab.id)}
              onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  className="tabbar__tab-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  {unread.has(tab.id) && !isActive && (
                    <span
                      className="tabbar__tab-activity"
                      title="后台有新输出"
                    />
                  )}
                  <span className="tabbar__tab-name">
                    {tab.name ?? "控制台"}
                  </span>
                  {tab.proxyEnabled && (
                    <span
                      className={`tabbar__tab-proxy ${
                        proxyConfigured ? "" : "tabbar__tab-proxy--unset"
                      }`}
                      title={proxyBadgeTitle}
                    >
                      P
                    </span>
                  )}
                </>
              )}
              {!isEditing && (
                <button
                  className="tabbar__tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(leaf.id, tab.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {dropIndicatorIndex != null && (
          <div
            className="tabbar__drop-indicator"
            style={{ left: calcIndicatorLeft() }}
          />
        )}
      </div>
      <button
        className="tabbar__add-btn"
        onClick={() => addTab(leaf.id)}
        title="新建终端"
      >
        +
      </button>
      {contextMenu && (
        <TabContextMenu
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onDuplicate={() => handleDuplicateTab(contextMenu.tabId)}
          onClose={() => closeTab(leaf.id, contextMenu.tabId)}
          onOpenInNewWindow={() => handleOpenInNewWindow(contextMenu.tabId)}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

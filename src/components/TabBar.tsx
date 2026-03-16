import { useState, useRef, useEffect, useCallback } from "react";
import { useLayoutStore } from "../store/layoutStore";
import type { TerminalLeaf } from "../types/layout";

interface PaneTabBarProps {
  leaf: TerminalLeaf;
}

/**
 * 面板级标签栏：渲染 leaf 中所有 tab，支持切换、新增、关闭、重命名。
 */
export function PaneTabBar({ leaf }: PaneTabBarProps) {
  const addTab = useLayoutStore((s) => s.addTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const renamePanel = useLayoutStore((s) => s.renamePanel);

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTabId]);

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

  return (
    <div className="tabbar">
      <div className="tabbar__tabs">
        {leaf.tabs.map((tab) => {
          const isActive = tab.id === leaf.activeTabId;
          const isEditing = editingTabId === tab.id;

          return (
            <div
              key={tab.id}
              className={`tabbar__tab ${isActive ? "tabbar__tab--active" : ""}`}
              onClick={() => setActiveTab(leaf.id, tab.id)}
              onDoubleClick={() =>
                handleDoubleClick(tab.id, tab.name ?? "控制台")
              }
              onMouseDown={(e) => handleMouseDown(e, tab.id)}
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
                <span className="tabbar__tab-name">
                  {tab.name ?? "控制台"}
                </span>
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
      </div>
      <button
        className="tabbar__add-btn"
        onClick={() => addTab(leaf.id)}
        title="新建终端"
      >
        +
      </button>
    </div>
  );
}

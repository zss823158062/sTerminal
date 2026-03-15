import React, { useEffect, useState, useCallback } from "react";
import type { SavedLayoutMeta, LayoutNode } from "../../types/layout";
import { layoutList, layoutLoad } from "../../ipc/layoutApi";
import { LayoutListItem } from "./LayoutListItem";

interface LayoutManagerDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 加载布局后回调，传入新的布局树 */
  onLayoutLoad: (tree: LayoutNode) => void;
  /** 工作目录警告 Toast 触发 */
  onWorkdirWarning?: (message: string) => void;
}

export const LayoutManagerDrawer: React.FC<LayoutManagerDrawerProps> = ({
  open,
  onClose,
  onLayoutLoad,
  onWorkdirWarning,
}) => {
  const [layouts, setLayouts] = useState<SavedLayoutMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchLayouts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await layoutList();
      setLayouts(list);
    } catch (e) {
      setError("加载失败：" + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchLayouts();
  }, [open, fetchLayouts]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleLoad = async (layoutId: string) => {
    const ok = confirm("加载布局将关闭当前所有面板，确认继续？");
    if (!ok) return;
    try {
      const saved = await layoutLoad(layoutId);
      onLayoutLoad(saved.tree);
      onClose();
      // 检查工作目录是否存在由后端处理，前端可通过事件获知
      if (onWorkdirWarning) {
        // 工作目录检查已在后端执行，此处预留接口
      }
    } catch (e) {
      alert("加载布局失败：" + String(e));
    }
  };

  const handleDeleted = (layoutId: string) => {
    setLayouts((prev) => prev.filter((l) => l.id !== layoutId));
  };

  const handleRenamed = (layoutId: string, newName: string) => {
    setLayouts((prev) =>
      prev.map((l) => (l.id === layoutId ? { ...l, name: newName } : l))
    );
  };

  if (!open) return null;

  return (
    <>
      {/* 遮罩 */}
      <div
        style={overlayStyle}
        onClick={onClose}
      />
      {/* 抽屉 */}
      <div style={drawerStyle}>
        <div style={headerStyle}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e0e0e0" }}>
            布局管理
          </span>
          <button onClick={onClose} style={closeBtnStyle} title="关闭">
            ✕
          </button>
        </div>

        <div style={bodyStyle}>
          {loading && (
            <div style={emptyStyle}>加载中...</div>
          )}
          {error && !loading && (
            <div style={{ ...emptyStyle, color: "#f87171" }}>{error}</div>
          )}
          {!loading && !error && layouts.length === 0 && (
            <div style={emptyStyle}>暂无保存的布局</div>
          )}
          {!loading && !error && layouts.map((layout) => (
            <LayoutListItem
              key={layout.id}
              layout={layout}
              onLoad={handleLoad}
              onDeleted={handleDeleted}
              onRenamed={handleRenamed}
            />
          ))}
        </div>
      </div>
    </>
  );
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 8000,
  background: "transparent",
};

const drawerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  width: 320,
  zIndex: 8001,
  background: "#1e1e1e",
  borderLeft: "1px solid #333",
  display: "flex",
  flexDirection: "column",
  boxShadow: "-4px 0 20px rgba(0,0,0,0.5)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 16px",
  borderBottom: "1px solid #333",
  height: 48,
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "8px 4px",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  color: "#666",
  fontSize: 13,
  padding: "40px 20px",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#999",
  fontSize: 14,
  padding: "4px 6px",
};

export default LayoutManagerDrawer;

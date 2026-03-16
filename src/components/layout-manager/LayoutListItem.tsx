import React, { useState } from "react";
import type { SavedLayoutMeta } from "../../types/layout";
import { layoutRename, layoutDelete } from "../../ipc/layoutApi";

interface LayoutListItemProps {
  layout: SavedLayoutMeta;
  /** 是否为当前活跃布局 */
  isActive?: boolean;
  /** 活跃布局是否有未保存的修改 */
  isDirty?: boolean;
  onLoad: (layoutId: string) => void;
  /** 覆盖保存当前布局（仅活跃布局可用） */
  onSave?: () => void;
  onDeleted: (layoutId: string) => void;
  onRenamed: (layoutId: string, newName: string) => void;
}

/** 将 ISO 8601 时间戳格式化为 "YYYY-MM-DD HH:mm" */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

export const LayoutListItem: React.FC<LayoutListItemProps> = ({
  layout,
  isActive,
  isDirty,
  onLoad,
  onSave,
  onDeleted,
  onRenamed,
}) => {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(layout.name);
  const [renameError, setRenameError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRenameConfirm = async () => {
    const v = renameValue.trim();
    if (!v) { setRenameError("名称不能为空"); return; }
    if (v.length > 50) { setRenameError("最长 50 个字符"); return; }
    setLoading(true);
    try {
      await layoutRename(layout.id, v);
      onRenamed(layout.id, v);
      setRenaming(false);
    } catch (e) {
      setRenameError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确认删除布局「${layout.name}」？`)) return;
    try {
      await layoutDelete(layout.id);
      onDeleted(layout.id);
    } catch (e) {
      alert("删除失败：" + String(e));
    }
  };

  return (
    <div
      style={{ ...itemStyle, background: hovered ? "rgba(255,255,255,0.05)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={infoStyle}>
        {renaming ? (
          <div>
            <input
              type="text"
              value={renameValue}
              autoFocus
              onChange={(e) => { setRenameValue(e.target.value); setRenameError(""); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameConfirm();
                if (e.key === "Escape") setRenaming(false);
              }}
              style={{ width: "100%", fontSize: 12 }}
              maxLength={50}
            />
            {renameError && <span style={errorStyle}>{renameError}</span>}
          </div>
        ) : (
          <span style={nameStyle}>
            {isActive && <span style={activeBadgeStyle}>●</span>}
            {layout.name}
          </span>
        )}
        <span style={metaStyle}>
          {formatDate(layout.updatedAt)} · {layout.panelCount} 个面板
        </span>
      </div>
      <div style={actionsStyle}>
        {renaming ? (
          <>
            <button onClick={handleRenameConfirm} disabled={loading} style={btnStyle}>
              {loading ? "..." : "确认"}
            </button>
            <button onClick={() => setRenaming(false)} style={btnStyle}>
              取消
            </button>
          </>
        ) : (
          <>
            {isActive && onSave && (
              <button
                onClick={onSave}
                disabled={!isDirty}
                style={{
                  ...btnStyle,
                  ...saveBtnStyle,
                  ...(!isDirty ? disabledSaveBtnStyle : {}),
                }}
                title={isDirty ? "保存当前修改到此布局" : "布局没有变化"}
              >
                保存
              </button>
            )}
            <button
              onClick={() => onLoad(layout.id)}
              style={btnStyle}
              title="加载此布局"
            >
              加载
            </button>
            <button
              onClick={() => { setRenaming(true); setRenameValue(layout.name); }}
              style={btnStyle}
              title="重命名"
            >
              重命名
            </button>
            <button
              onClick={handleDelete}
              style={{ ...btnStyle, ...dangerBtnStyle }}
              title="删除布局"
            >
              删除
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 12px",
  borderRadius: 4,
  transition: "background 100ms ease",
  cursor: "default",
  gap: 8,
};

const infoStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const nameStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#e0e0e0",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const activeBadgeStyle: React.CSSProperties = {
  color: "#4ade80",
  marginRight: 4,
  fontSize: 10,
};

const metaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  flexShrink: 0,
};

const btnStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  background: "#2a2a2a",
  color: "#e0e0e0",
  borderRadius: 3,
};

const saveBtnStyle: React.CSSProperties = {
  color: "#4ade80",
};

const disabledSaveBtnStyle: React.CSSProperties = {
  color: "#666",
  cursor: "not-allowed",
};

const dangerBtnStyle: React.CSSProperties = {
  color: "#f87171",
};

const errorStyle: React.CSSProperties = {
  color: "#f87171",
  fontSize: 10,
};

export default LayoutListItem;

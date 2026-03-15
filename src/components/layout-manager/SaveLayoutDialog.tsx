import React, { useState, useEffect, useRef } from "react";
import { layoutSave } from "../../ipc/layoutApi";
import type { LayoutNode } from "../../types/layout";

interface SaveLayoutDialogProps {
  defaultName: string;
  tree: LayoutNode;
  onSuccess: (layoutId: string, name: string) => void;
  onCancel: () => void;
}

export const SaveLayoutDialog: React.FC<SaveLayoutDialogProps> = ({
  defaultName,
  tree,
  onSuccess,
  onCancel,
}) => {
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 自动聚焦输入框并全选
    inputRef.current?.select();
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const validate = (v: string): string => {
    if (!v.trim()) return "布局名称不能为空";
    if (v.trim().length > 50) return "布局名称最长 50 个字符";
    return "";
  };

  const handleConfirm = async () => {
    const trimmed = name.trim();
    const err = validate(trimmed);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    try {
      const id = await layoutSave(trimmed, tree);
      onSuccess(id, trimmed);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleConfirm();
  };

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={dialogStyle}>
        <h3 style={titleStyle}>保存布局</h3>
        <p style={labelStyle}>布局名称</p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={handleKeyDown}
          maxLength={50}
          style={{ width: "100%", marginBottom: error ? 4 : 16 }}
          placeholder="输入布局名称..."
        />
        {error && <p style={errorStyle}>{error}</p>}
        <div style={actionsStyle}>
          <button onClick={onCancel} style={{ marginRight: 8 }}>
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            style={primaryBtnStyle}
          >
            {saving ? "保存中..." : "确认"}
          </button>
        </div>
      </div>
    </div>
  );
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10000,
  background: "rgba(0,0,0,0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const dialogStyle: React.CSSProperties = {
  background: "#252525",
  border: "1px solid #333",
  borderRadius: 8,
  padding: "20px 24px",
  minWidth: 320,
  maxWidth: 400,
};

const titleStyle: React.CSSProperties = {
  marginBottom: 16,
  fontSize: 14,
  color: "#e0e0e0",
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#999",
  marginBottom: 6,
};

const errorStyle: React.CSSProperties = {
  color: "#f87171",
  fontSize: 11,
  marginBottom: 12,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const primaryBtnStyle: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
};

export default SaveLayoutDialog;

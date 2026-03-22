import React, { useState, useEffect, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { AppSettings } from "../../types/layout";
import type { ShellInfo } from "../../types/terminal";
import { shellListAvailable } from "../../ipc/terminalApi";

interface AppSettingsDialogProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onCancel: () => void;
}

export const AppSettingsDialog: React.FC<AppSettingsDialogProps> = ({
  settings,
  onSave,
  onCancel,
}) => {
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [version, setVersion] = useState("");
  const [defaultShell, setDefaultShell] = useState(settings.defaultShell);
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState(
    settings.defaultWorkingDirectory
  );
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    shellListAvailable()
      .then((list) => {
        setShells(list);
        // 如果当前设置的 shell 不在列表中，选中第一个默认 shell
        if (defaultShell === "" || !list.some((s) => s.type === defaultShell)) {
          const defaultOne = list.find((s) => s.isDefault);
          if (defaultOne) setDefaultShell(defaultOne.type);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  useEffect(() => {
    selectRef.current?.focus();
  }, [shells]);

  const handleSave = () => {
    const selectedShell = shells.find((s) => s.type === defaultShell);
    onSave({
      ...settings,
      defaultShell,
      defaultShellPath: selectedShell?.path ?? "",
      defaultWorkingDirectory,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
  };

  return (
    <div
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div style={dialogStyle} onKeyDown={handleKeyDown}>
        <h3 style={titleStyle}>设置</h3>

        <label style={labelStyle}>默认 Shell</label>
        <select
          ref={selectRef}
          value={defaultShell}
          onChange={(e) => setDefaultShell(e.target.value)}
          style={selectStyle}
        >
          {shells.map((s) => (
            <option key={s.path} value={s.type}>
              {s.displayName}
              {s.isDefault ? " (系统默认)" : ""}
            </option>
          ))}
        </select>

        <label style={labelStyle}>默认工作目录</label>
        <input
          type="text"
          value={defaultWorkingDirectory}
          onChange={(e) => setDefaultWorkingDirectory(e.target.value)}
          placeholder="留空使用用户主目录"
          style={{ ...inputStyle, marginBottom: 20 }}
        />

        {version && (
          <div style={versionInfoStyle}>sTerminal v{version}</div>
        )}

        <div style={actionsStyle}>
          <button onClick={onCancel} style={btnStyle}>
            取消
          </button>
          <button onClick={handleSave} style={primaryBtnStyle}>
            保存
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
  minWidth: 340,
  maxWidth: 420,
};

const titleStyle: React.CSSProperties = {
  marginBottom: 16,
  fontSize: 14,
  color: "#e0e0e0",
  fontWeight: 600,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#999",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginBottom: 12,
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  marginBottom: 12,
  padding: "6px 8px",
  background: "#1a1a1a",
  color: "#e0e0e0",
  border: "1px solid #444",
  borderRadius: 4,
  fontSize: 13,
  outline: "none",
};

const versionInfoStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
  textAlign: "center",
  marginBottom: 16,
  paddingTop: 8,
  borderTop: "1px solid #333",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

const btnStyle: React.CSSProperties = {};

const primaryBtnStyle: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
};

export default AppSettingsDialog;

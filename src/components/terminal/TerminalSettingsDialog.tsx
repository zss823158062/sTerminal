import React, { useState, useEffect, useRef } from "react";
import type { TerminalSession } from "../../types/layout";
import type { ShellInfo } from "../../types/terminal";
import { shellListAvailable } from "../../ipc/terminalApi";

interface TerminalSettingsDialogProps {
  session: TerminalSession;
  onApply: (config: Partial<TerminalSession>) => void;
  onCancel: () => void;
}

export const TerminalSettingsDialog: React.FC<TerminalSettingsDialogProps> = ({
  session,
  onApply,
  onCancel,
}) => {
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [selectedShellIdx, setSelectedShellIdx] = useState(-1);
  const [workingDirectory, setWorkingDirectory] = useState(session.workingDirectory);
  const [startupCommand, setStartupCommand] = useState(session.startupCommand ?? "");
  const [name, setName] = useState(session.name ?? "");
  const firstInputRef = useRef<HTMLSelectElement>(null);

  // 加载 shell 列表
  useEffect(() => {
    shellListAvailable().then((list) => {
      setShells(list);
      // 匹配当前 session 的 shell
      const idx = list.findIndex(
        (s) => s.path === session.shellPath || s.type === session.shellType
      );
      setSelectedShellIdx(idx >= 0 ? idx : 0);
    }).catch(console.error);
  }, [session.shellPath, session.shellType]);

  // ESC 关闭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  // 自动聚焦
  useEffect(() => {
    firstInputRef.current?.focus();
  }, [shells]);

  const handleApply = () => {
    const config: Partial<TerminalSession> = {};
    const shell = shells[selectedShellIdx];

    if (shell && (shell.type !== session.shellType || shell.path !== session.shellPath)) {
      config.shellType = shell.type;
      config.shellPath = shell.path;
    }
    if (workingDirectory !== session.workingDirectory) {
      config.workingDirectory = workingDirectory;
    }
    if (startupCommand !== (session.startupCommand ?? "")) {
      config.startupCommand = startupCommand || undefined;
    }
    if (name !== (session.name ?? "")) {
      config.name = name;
    }

    onApply(config);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleApply();
  };

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={dialogStyle} onKeyDown={handleKeyDown}>
        <h3 style={titleStyle}>终端设置</h3>

        <label style={labelStyle}>Shell 类型</label>
        <select
          ref={firstInputRef}
          value={selectedShellIdx}
          onChange={(e) => setSelectedShellIdx(Number(e.target.value))}
          style={selectStyle}
        >
          {shells.map((s, i) => (
            <option key={s.path} value={i}>
              {s.displayName}{s.isDefault ? " (默认)" : ""}
            </option>
          ))}
        </select>

        <label style={labelStyle}>启动目录</label>
        <input
          type="text"
          value={workingDirectory}
          onChange={(e) => setWorkingDirectory(e.target.value)}
          placeholder="留空使用默认目录"
          style={inputStyle}
        />

        <label style={labelStyle}>启动命令</label>
        <input
          type="text"
          value={startupCommand}
          onChange={(e) => setStartupCommand(e.target.value)}
          placeholder="终端启动后自动执行的命令"
          style={inputStyle}
        />

        <label style={labelStyle}>标签名称</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="自定义标签名称"
          style={{ ...inputStyle, marginBottom: 20 }}
          maxLength={50}
        />

        <div style={actionsStyle}>
          <button onClick={onCancel} style={btnStyle}>
            取消
          </button>
          <button onClick={handleApply} style={primaryBtnStyle}>
            应用
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

export default TerminalSettingsDialog;

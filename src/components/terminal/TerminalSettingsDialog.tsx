import React, { useState, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { TerminalSession } from "../../types/layout";
import type { ShellInfo } from "../../types/terminal";
import { shellListAvailable } from "../../ipc/terminalApi";
import { useSettingsStore } from "../../store/settingsStore";
import { hasProxyUrl, normalizeProxyUrl } from "../../utils/proxyEnv";

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
  const [proxyEnabled, setProxyEnabled] = useState(!!session.proxyEnabled);
  const firstInputRef = useRef<HTMLSelectElement>(null);

  // 代理地址是全局设置，这里只提供开关
  const appSettings = useSettingsStore((s) => s.settings);
  const proxyConfigured = hasProxyUrl(appSettings);

  // 加载 shell 列表
  useEffect(() => {
    shellListAvailable().then((list) => {
      setShells(list);
      // 匹配当前 session 的 shell；同一 path 可能有普通/管理员两项，需同时比对 elevated
      const elevated = !!session.elevated;
      const idx = list.findIndex(
        (s) =>
          s.elevated === elevated &&
          (s.path === session.shellPath || s.type === session.shellType)
      );
      setSelectedShellIdx(idx >= 0 ? idx : 0);
    }).catch(console.error);
  }, [session.shellPath, session.shellType, session.elevated]);

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

    if (
      shell &&
      (shell.type !== session.shellType ||
        shell.path !== session.shellPath ||
        shell.elevated !== !!session.elevated)
    ) {
      config.shellType = shell.type;
      config.shellPath = shell.path;
      config.elevated = shell.elevated || undefined;
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
    if (proxyEnabled !== !!session.proxyEnabled) {
      config.proxyEnabled = proxyEnabled;
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
            <option key={`${s.path}|${s.elevated}`} value={i}>
              {s.displayName}{s.isDefault ? " (默认)" : ""}
            </option>
          ))}
        </select>

        <label style={labelStyle}>启动目录</label>
        <div style={rowStyle}>
          <input
            type="text"
            value={workingDirectory}
            onChange={(e) => setWorkingDirectory(e.target.value)}
            placeholder="留空使用默认目录"
            style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
          />
          <button
            type="button"
            style={browseBtnStyle}
            title="选择文件夹"
            onClick={async () => {
              const selected = await open({
                directory: true,
                multiple: false,
                defaultPath: workingDirectory || undefined,
              });
              if (typeof selected === "string") setWorkingDirectory(selected);
            }}
          >
            …
          </button>
        </div>

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
          style={inputStyle}
          maxLength={50}
        />

        <label
          style={{
            ...checkboxRowStyle,
            ...(proxyConfigured ? {} : disabledRowStyle),
          }}
        >
          <input
            type="checkbox"
            checked={proxyEnabled}
            onChange={(e) => setProxyEnabled(e.target.checked)}
            disabled={!proxyConfigured}
          />
          <span>启用 HTTP 代理</span>
        </label>
        <div style={hintStyle}>
          {proxyConfigured
            ? `使用全局代理 ${normalizeProxyUrl(appSettings.proxyUrl ?? "")}，仅影响本控制台。`
            : "未配置代理地址，请先在应用设置中填写 HTTP 代理。"}
        </div>

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

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginBottom: 12,
};

const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: "#e0e0e0",
  marginBottom: 6,
  cursor: "pointer",
  userSelect: "none",
};

const disabledRowStyle: React.CSSProperties = {
  color: "#777",
  cursor: "default",
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#777",
  marginBottom: 20,
};

const browseBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#333",
  color: "#ccc",
  border: "1px solid #444",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 13,
  flexShrink: 0,
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

import React, { useState, useEffect, useMemo, useRef } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../../types/layout";
import type { ShellInfo } from "../../types/terminal";
import { shellListAvailable } from "../../ipc/terminalApi";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
} from "../../terminal/terminalInstances";
import { DEFAULT_NO_PROXY } from "../../utils/proxyEnv";

interface AppSettingsDialogProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onCancel: () => void;
}

/** 仅保留"默认"选项作为顶部固定项，其余字体从系统枚举获取 */
const DEFAULT_FONT_OPTION = { label: "默认 (JetBrains Mono Nerd Font)", value: "" };

const CUSTOM_FONT_VALUE = "__custom__";

/** 把字体族名转为 CSS font-family 值（含引号，附加 monospace 回退） */
function familyToFontFamilyValue(family: string): string {
  return `"${family.replace(/"/g, '\\"')}", Consolas, monospace`;
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
  const [fontFamily, setFontFamily] = useState(settings.fontFamily ?? "");
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(true);

  // 动态构建字体选项：默认项 + 系统等宽字体（字母序）
  const fontOptions = useMemo(
    () => [
      DEFAULT_FONT_OPTION,
      ...systemFonts.map((f) => ({
        label: f,
        value: familyToFontFamilyValue(f),
      })),
    ],
    [systemFonts]
  );

  const [fontSelectValue, setFontSelectValue] = useState(() => {
    const saved = settings.fontFamily ?? "";
    if (saved === "") return "";
    return CUSTOM_FONT_VALUE;
  });
  const [fontSize, setFontSize] = useState(
    settings.fontSize != null ? String(settings.fontSize) : ""
  );
  const [lineHeight, setLineHeight] = useState(
    settings.lineHeight != null ? String(settings.lineHeight) : ""
  );
  // 未设置视为开启（默认走 WebGL）
  const [gpuAcceleration, setGpuAcceleration] = useState(
    settings.gpuAcceleration !== false
  );
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl ?? "");
  const [noProxy, setNoProxy] = useState(settings.noProxy ?? "");
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // 加载系统已安装的等宽字体
  useEffect(() => {
    let cancelled = false;
    invoke<string[]>("list_monospace_fonts")
      .then((list) => {
        if (cancelled) return;
        setSystemFonts(list);
      })
      .catch((err) => {
        console.error("[AppSettings] list_monospace_fonts failed:", err);
      })
      .finally(() => {
        if (!cancelled) setFontsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 字体列表就绪后，若已保存的 fontFamily 能匹配系统字体族，自动切到对应选项
  useEffect(() => {
    if (systemFonts.length === 0) return;
    const saved = settings.fontFamily ?? "";
    if (saved === "") {
      setFontSelectValue("");
      return;
    }
    const matched = systemFonts.find(
      (f) => familyToFontFamilyValue(f) === saved
    );
    if (matched) {
      setFontSelectValue(familyToFontFamilyValue(matched));
    }
    // 未匹配则保持 CUSTOM_FONT_VALUE 由用户手工编辑
  }, [systemFonts, settings.fontFamily]);

  useEffect(() => {
    shellListAvailable()
      .then((list) => {
        // 管理员变体与普通项共用 type，且每开一个标签都弹 UAC，不适合作默认 Shell
        setShells(list.filter((s) => !s.elevated));
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
    const parsedFontSize = parseFloat(fontSize);
    const parsedLineHeight = parseFloat(lineHeight);
    onSave({
      ...settings,
      defaultShell,
      defaultShellPath: selectedShell?.path ?? "",
      defaultWorkingDirectory,
      fontFamily: fontFamily.trim() || undefined,
      fontSize:
        Number.isFinite(parsedFontSize) && parsedFontSize > 0
          ? parsedFontSize
          : undefined,
      lineHeight:
        Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
          ? parsedLineHeight
          : undefined,
      gpuAcceleration,
      proxyUrl: proxyUrl.trim() || undefined,
      noProxy: noProxy.trim() || undefined,
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
          style={inputStyle}
        />

        <label style={labelStyle}>
          字体
          {fontsLoading && (
            <span style={loadingHintStyle}> （加载系统字体中…）</span>
          )}
        </label>
        <select
          value={fontSelectValue}
          onChange={(e) => {
            const v = e.target.value;
            setFontSelectValue(v);
            if (v !== CUSTOM_FONT_VALUE) setFontFamily(v);
          }}
          style={selectStyle}
          disabled={fontsLoading}
        >
          {fontOptions.map((p) => (
            <option key={p.label} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM_FONT_VALUE}>自定义…</option>
        </select>
        {fontSelectValue === CUSTOM_FONT_VALUE && (
          <input
            type="text"
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            placeholder={`例如: ${DEFAULT_FONT_FAMILY.split(",")[0]}`}
            style={inputStyle}
          />
        )}

        <div style={rowStyle}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>字号</label>
            <input
              type="number"
              min={6}
              max={72}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
              placeholder={String(DEFAULT_FONT_SIZE)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>行高</label>
            <input
              type="number"
              min={0.8}
              max={3}
              step={0.1}
              value={lineHeight}
              onChange={(e) => setLineHeight(e.target.value)}
              placeholder={String(DEFAULT_LINE_HEIGHT)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={hintStyle}>字体设置仅对新建终端生效</div>

        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            checked={gpuAcceleration}
            onChange={(e) => setGpuAcceleration(e.target.checked)}
          />
          <span>GPU 加速渲染</span>
        </label>
        <div style={hintStyle}>
          关闭后改用 DOM 渲染，兼容性最好但滚动性能下降。
          若终端偶发字形错乱且 Ctrl+Shift+R 重绘无法长期改善，可尝试关闭。
          仅对新建终端生效。
        </div>

        <label style={labelStyle}>HTTP 代理</label>
        <input
          type="text"
          value={proxyUrl}
          onChange={(e) => setProxyUrl(e.target.value)}
          placeholder="例如: http://127.0.0.1:7890"
          style={inputStyle}
          spellCheck={false}
        />

        <label style={labelStyle}>不使用代理的地址</label>
        <input
          type="text"
          value={noProxy}
          onChange={(e) => setNoProxy(e.target.value)}
          placeholder={`留空使用 ${DEFAULT_NO_PROXY}`}
          style={inputStyle}
          spellCheck={false}
        />
        <div style={hintStyle}>
          填写地址后，在终端里右键 →「当前控制台设置」中逐个开关。
          开启的控制台会注入 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY（含小写形式），
          标签名后会显示 P 标记。
          改动地址后，已开启的控制台需重新拨一次开关或新建终端才会用上新值。
        </div>

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

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 12,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#777",
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

const loadingHintStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
  marginLeft: 4,
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

import React, { useState, useEffect, useMemo } from "react";
import type { ClaudeSessionMeta, ActiveClaudeSession } from "../../types/claude";
import { claudeSessionsList, claudeActiveSessions } from "../../ipc/claudeApi";

interface ClaudeSessionDialogProps {
  /** 目标面板的运行时工作目录，决定读取哪个项目的会话 */
  cwd: string;
  /** 目标面板显示名，用于头部提示是哪个面板 */
  panelLabel?: string;
  /** 选中一个会话，参数为 sessionId */
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期 */
function formatRelativeTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ms).toLocaleDateString();
}

/** 活跃状态 → 徽标文案与配色 */
function statusBadge(active: ActiveClaudeSession): {
  label: string;
  color: string;
} {
  switch (active.status) {
    case "busy":
      return { label: "运行中", color: "#4ade80" };
    case "waiting":
      return {
        label: active.waitingFor ? `等待 · ${active.waitingFor}` : "等待输入",
        color: "#fbbf24",
      };
    default:
      return { label: "空闲", color: "#60a5fa" };
  }
}

/** 文件字节数 → 易读体积 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const ClaudeSessionDialog: React.FC<ClaudeSessionDialogProps> = ({
  cwd,
  panelLabel,
  onSelect,
  onClose,
}) => {
  const [sessions, setSessions] = useState<ClaudeSessionMeta[]>([]);
  const [activeMap, setActiveMap] = useState<Map<string, ActiveClaudeSession>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([claudeSessionsList(cwd), claudeActiveSessions()])
      .then(([list, active]) => {
        if (cancelled) return;
        setSessions(list);
        setActiveMap(new Map(active.map((a) => [a.sessionId, a])));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(kw) ||
        s.lastPrompt.toLowerCase().includes(kw) ||
        s.sessionId.toLowerCase().includes(kw)
    );
  }, [sessions, keyword]);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={titleStyle}>Claude 会话</div>
            <div style={cwdStyle} title={cwd}>
              {panelLabel ? `${panelLabel} · ` : ""}
              {cwd || "（未知目录）"}
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle} title="关闭 (Esc)">
            ✕
          </button>
        </div>

        <input
          type="text"
          placeholder="搜索标题、内容或会话 ID"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={searchStyle}
          autoFocus
        />

        <div style={bodyStyle}>
          {loading && <div style={hintStyle}>读取会话记录…</div>}
          {!loading && error && (
            <div style={{ ...hintStyle, color: "#f87171" }}>
              读取失败：{error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={hintStyle}>
              {sessions.length === 0
                ? "该目录下还没有 Claude 会话记录"
                : "没有匹配的会话"}
            </div>
          )}
          {!loading &&
            !error &&
            filtered.map((s) => {
              const active = activeMap.get(s.sessionId);
              const badge = active ? statusBadge(active) : null;
              return (
                <button
                  key={s.sessionId}
                  className="claude-session-item"
                  style={itemStyle}
                  onClick={() => onSelect(s.sessionId)}
                  title={s.lastPrompt || s.title}
                >
                  <span style={itemTopStyle}>
                    <span style={itemTitleStyle}>
                      {s.title || "未命名会话"}
                    </span>
                    {badge && (
                      <span
                        style={{
                          ...badgeStyle,
                          color: badge.color,
                          borderColor: badge.color,
                        }}
                      >
                        {badge.label}
                      </span>
                    )}
                  </span>
                  <span style={itemMetaStyle}>
                    <span>{formatRelativeTime(s.updatedAt)}</span>
                    {s.gitBranch && <span>· {s.gitBranch}</span>}
                    <span>· {formatSize(s.sizeBytes)}</span>
                    <span style={idStyle}>· {s.sessionId.slice(0, 8)}</span>
                  </span>
                </button>
              );
            })}
        </div>

        <div style={footerStyle}>
          选中后在当前面板新开 Tab 执行{" "}
          <code style={codeStyle}>claude --resume</code>
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
  padding: "16px 18px",
  width: 600,
  maxWidth: "90vw",
  maxHeight: "70vh",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#e0e0e0",
};

const cwdStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#777",
  marginTop: 3,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#999",
  fontSize: 14,
  padding: "2px 6px",
  cursor: "pointer",
  flexShrink: 0,
};

const searchStyle: React.CSSProperties = {
  background: "#2a2a2a",
  border: "1px solid #444",
  borderRadius: 4,
  padding: "6px 10px",
  color: "#e0e0e0",
  fontSize: 13,
  outline: "none",
  marginBottom: 8,
  flexShrink: 0,
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  minHeight: 120,
};

const hintStyle: React.CSSProperties = {
  textAlign: "center",
  color: "#666",
  fontSize: 13,
  padding: "40px 20px",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  width: "100%",
  padding: "8px 10px",
  marginBottom: 2,
  borderRadius: 4,
  textAlign: "left",
};

const itemTopStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};

const itemTitleStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#e0e0e0",
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flex: 1,
  minWidth: 0,
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  padding: "1px 6px",
  borderRadius: 10,
  border: "1px solid",
  flexShrink: 0,
  whiteSpace: "nowrap",
};

const itemMetaStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  fontSize: 11,
  color: "#777",
  whiteSpace: "nowrap",
  overflow: "hidden",
};

const idStyle: React.CSSProperties = {
  fontFamily: "monospace",
  color: "#555",
};

const footerStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
  paddingTop: 10,
  marginTop: 8,
  borderTop: "1px solid #333",
  flexShrink: 0,
};

const codeStyle: React.CSSProperties = {
  fontFamily: "monospace",
  color: "#4ade80",
};

export default ClaudeSessionDialog;

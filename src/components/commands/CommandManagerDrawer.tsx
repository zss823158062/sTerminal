import React, { useState, useCallback, useEffect } from "react";
import type { CommonCommand, CommandGroup } from "../../types/layout";
import { useSettingsStore } from "../../store/settingsStore";
import { useConfirm } from "../../hooks/useConfirm";
import { getTerminal } from "../../terminal/terminalInstances";
import { terminalWrite } from "../../ipc/terminalApi";
import { useLayoutStore } from "../../store/layoutStore";
import { findLeafById } from "../../utils/layoutTree";

interface CommandManagerDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** 将命令文本粘贴到当前焦点终端（不追加回车） */
function pasteToFocusedTerminal(command: string): boolean {
  const { layoutTree, focusedPanelId } = useLayoutStore.getState();
  if (!focusedPanelId) return false;

  const leaf = findLeafById(layoutTree, focusedPanelId);
  if (!leaf) return false;

  const sessionId = leaf.activeTabId;
  const managed = getTerminal(sessionId);
  if (!managed?.terminalId) return false;

  terminalWrite(managed.terminalId, new TextEncoder().encode(command));
  return true;
}

type EditTarget =
  | { type: "addGroup" }
  | { type: "editGroup"; groupId: string }
  | { type: "addCommand"; groupId: string }
  | { type: "editCommand"; groupId: string; commandId: string }
  | null;

export const CommandManagerDrawer: React.FC<CommandManagerDrawerProps> = ({
  open,
  onClose,
}) => {
  const [confirm, ConfirmPortal] = useConfirm();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.updateSettings);

  const groups: CommandGroup[] = settings.commandGroups ?? [];

  // 折叠状态：记录收起的 groupId
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // 编辑状态
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [editName, setEditName] = useState("");
  const [editCommand, setEditCommand] = useState("");

  const resetEdit = useCallback(() => {
    setEditTarget(null);
    setEditName("");
    setEditCommand("");
  }, []);

  useEffect(() => {
    if (!open) resetEdit();
  }, [open, resetEdit]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editTarget) {
          resetEdit();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, editTarget, resetEdit]);

  const saveGroups = useCallback(
    async (newGroups: CommandGroup[]) => {
      await updateSettings({ ...settings, commandGroups: newGroups });
    },
    [settings, updateSettings]
  );

  const toggleCollapse = (groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // ── 分组操作 ──

  const handleAddGroup = () => {
    resetEdit();
    setEditTarget({ type: "addGroup" });
  };

  const handleEditGroup = (group: CommandGroup) => {
    resetEdit();
    setEditTarget({ type: "editGroup", groupId: group.id });
    setEditName(group.name);
  };

  const handleDeleteGroup = async (group: CommandGroup) => {
    const ok = await confirm({
      message: `确认删除分组「${group.name}」及其所有命令？`,
      title: "删除分组",
      kind: "danger",
    });
    if (!ok) return;
    await saveGroups(groups.filter((g) => g.id !== group.id));
    resetEdit();
  };

  // ── 命令操作 ──

  const handleAddCommand = (groupId: string) => {
    resetEdit();
    setEditTarget({ type: "addCommand", groupId });
    // 展开该分组
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  };

  /** 头部 "+ 命令" 按钮：无分组时自动创建默认分组 */
  const handleAddCommandGlobal = async () => {
    let targetGroupId: string;
    if (groups.length === 0) {
      const newGroup: CommandGroup = {
        id: crypto.randomUUID(),
        name: "默认",
        commands: [],
      };
      await saveGroups([newGroup]);
      targetGroupId = newGroup.id;
    } else {
      targetGroupId = groups[0].id;
    }
    handleAddCommand(targetGroupId);
  };

  const handleEditCommand = (groupId: string, cmd: CommonCommand) => {
    resetEdit();
    setEditTarget({ type: "editCommand", groupId, commandId: cmd.id });
    setEditName(cmd.name);
    setEditCommand(cmd.command);
  };

  const handleDeleteCommand = async (groupId: string, cmd: CommonCommand) => {
    const ok = await confirm({
      message: `确认删除命令「${cmd.name}」？`,
      title: "删除命令",
      kind: "danger",
    });
    if (!ok) return;
    await saveGroups(
      groups.map((g) =>
        g.id === groupId
          ? { ...g, commands: g.commands.filter((c) => c.id !== cmd.id) }
          : g
      )
    );
    resetEdit();
  };

  const handlePaste = (command: string) => {
    pasteToFocusedTerminal(command);
    onClose();
  };

  // ── 保存编辑 ──

  const handleSave = async () => {
    if (!editTarget) return;

    if (editTarget.type === "addGroup" || editTarget.type === "editGroup") {
      const name = editName.trim();
      if (!name) return;

      if (editTarget.type === "addGroup") {
        const newGroup: CommandGroup = {
          id: crypto.randomUUID(),
          name,
          commands: [],
        };
        await saveGroups([...groups, newGroup]);
      } else {
        await saveGroups(
          groups.map((g) =>
            g.id === editTarget.groupId ? { ...g, name } : g
          )
        );
      }
    } else {
      // addCommand | editCommand
      const name = editName.trim();
      const command = editCommand.trim();
      if (!name || !command) return;

      if (editTarget.type === "addCommand") {
        const newCmd: CommonCommand = {
          id: crypto.randomUUID(),
          name,
          command,
        };
        await saveGroups(
          groups.map((g) =>
            g.id === editTarget.groupId
              ? { ...g, commands: [...g.commands, newCmd] }
              : g
          )
        );
      } else {
        await saveGroups(
          groups.map((g) =>
            g.id === editTarget.groupId
              ? {
                  ...g,
                  commands: g.commands.map((c) =>
                    c.id === editTarget.commandId ? { ...c, name, command } : c
                  ),
                }
              : g
          )
        );
      }
    }
    resetEdit();
  };

  const isGroupEdit =
    editTarget?.type === "addGroup" || editTarget?.type === "editGroup";
  const isCommandEdit =
    editTarget?.type === "addCommand" || editTarget?.type === "editCommand";

  if (!open) return null;

  return (
    <>
      <div style={overlayStyle} onClick={onClose} />
      <div style={drawerStyle}>
        {/* 头部 */}
        <div style={headerStyle}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e0e0e0" }}>
            常用命令
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button onClick={handleAddCommandGlobal} style={addBtnStyle} title="新增命令">
              + 命令
            </button>
            <button onClick={handleAddGroup} style={addGroupBtnStyle} title="新增分组">
              + 分组
            </button>
            <button onClick={onClose} style={closeBtnStyle} title="关闭">
              ✕
            </button>
          </div>
        </div>

        {/* 编辑区域 */}
        {editTarget && (
          <div style={editAreaStyle}>
            {isGroupEdit && (
              <>
                <input
                  type="text"
                  placeholder="分组名称"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={inputStyle}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                />
              </>
            )}
            {isCommandEdit && (
              <>
                <input
                  type="text"
                  placeholder="命令名称"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={inputStyle}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                  }}
                />
                <textarea
                  placeholder="命令文本"
                  value={editCommand}
                  onChange={(e) => setEditCommand(e.target.value)}
                  style={textareaStyle}
                  rows={3}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.ctrlKey) handleSave();
                  }}
                />
              </>
            )}
            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button onClick={resetEdit} style={cancelBtnStyle}>
                取消
              </button>
              <button
                onClick={handleSave}
                style={saveBtnStyle}
                disabled={
                  isGroupEdit
                    ? !editName.trim()
                    : !editName.trim() || !editCommand.trim()
                }
              >
                保存
              </button>
            </div>
          </div>
        )}

        {/* 分组列表 */}
        <div style={bodyStyle}>
          {groups.length === 0 && !editTarget && (
            <div style={emptyStyle}>暂无命令分组，点击上方 + 分组</div>
          )}
          {groups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.id);
            return (
              <div key={group.id} style={{ marginBottom: 4 }}>
                {/* 分组头 */}
                <div
                  style={{
                    ...groupHeaderStyle,
                    ...(editTarget?.type === "editGroup" &&
                    editTarget.groupId === group.id
                      ? { background: "rgba(74, 222, 128, 0.08)" }
                      : {}),
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, cursor: "pointer" }}
                    onClick={() => toggleCollapse(group.id)}
                  >
                    <span style={chevronStyle}>
                      {isCollapsed ? "▸" : "▾"}
                    </span>
                    <span style={groupNameStyle}>{group.name}</span>
                    <span style={groupCountStyle}>({group.commands.length})</span>
                  </div>
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button
                      onClick={() => handleAddCommand(group.id)}
                      style={groupActionBtnStyle}
                      title="添加命令"
                    >
                      +
                    </button>
                    <button
                      onClick={() => handleEditGroup(group)}
                      style={groupActionBtnStyle}
                      title="编辑分组名"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      style={{ ...groupActionBtnStyle, color: "#f87171" }}
                      title="删除分组"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* 命令列表 */}
                {!isCollapsed &&
                  group.commands.map((cmd) => (
                    <div
                      key={cmd.id}
                      style={{
                        ...itemStyle,
                        ...(editTarget?.type === "editCommand" &&
                        "commandId" in editTarget &&
                        editTarget.commandId === cmd.id
                          ? itemActiveStyle
                          : {}),
                      }}
                    >
                      <div
                        style={itemContentStyle}
                        onClick={() => handleEditCommand(group.id, cmd)}
                        title="点击编辑"
                      >
                        <div style={itemNameStyle}>{cmd.name}</div>
                        <div style={itemCommandStyle}>{cmd.command}</div>
                      </div>
                      <div style={itemActionsStyle}>
                        <button
                          onClick={() => handlePaste(cmd.command)}
                          style={pasteBtnStyle}
                          title="粘贴到终端"
                        >
                          ▶
                        </button>
                        <button
                          onClick={() => handleEditCommand(group.id, cmd)}
                          style={editBtnStyle}
                          title="编辑命令"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeleteCommand(group.id, cmd)}
                          style={deleteBtnStyle}
                          title="删除"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}

                {/* 空分组提示 */}
                {!isCollapsed && group.commands.length === 0 && (
                  <div style={emptyGroupStyle}>
                    暂无命令，点击 + 添加
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmPortal />
    </>
  );
};

// ── 样式 ──

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

const addBtnStyle: React.CSSProperties = {
  padding: "3px 10px",
  fontSize: 12,
  color: "#4ade80",
  background: "rgba(74, 222, 128, 0.1)",
  borderRadius: 3,
  cursor: "pointer",
};

const addGroupBtnStyle: React.CSSProperties = {
  padding: "3px 10px",
  fontSize: 12,
  color: "#999",
  background: "rgba(255, 255, 255, 0.05)",
  borderRadius: 3,
  cursor: "pointer",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#999",
  fontSize: 14,
  padding: "4px 6px",
  cursor: "pointer",
};

const editAreaStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #333",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  background: "#2a2a2a",
  border: "1px solid #444",
  borderRadius: 4,
  padding: "6px 10px",
  color: "#e0e0e0",
  fontSize: 13,
  outline: "none",
};

const textareaStyle: React.CSSProperties = {
  background: "#2a2a2a",
  border: "1px solid #444",
  borderRadius: 4,
  padding: "6px 10px",
  color: "#e0e0e0",
  fontSize: 13,
  outline: "none",
  resize: "vertical",
  fontFamily: "monospace",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  color: "#999",
  background: "transparent",
  borderRadius: 3,
  cursor: "pointer",
};

const saveBtnStyle: React.CSSProperties = {
  padding: "4px 12px",
  fontSize: 12,
  color: "#4ade80",
  background: "rgba(74, 222, 128, 0.1)",
  borderRadius: 3,
  cursor: "pointer",
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

const groupHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 12px",
  margin: "2px 4px",
  borderRadius: 4,
  transition: "background 0.15s",
};

const chevronStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  marginRight: 6,
  width: 10,
  textAlign: "center",
};

const groupNameStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#e0e0e0",
  fontWeight: 600,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const groupCountStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
  marginLeft: 6,
  flexShrink: 0,
};

const groupActionBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  fontSize: 12,
  padding: "2px 5px",
  borderRadius: 3,
  cursor: "pointer",
};

const emptyGroupStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#555",
  padding: "8px 32px",
  fontStyle: "italic",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "6px 12px 6px 28px",
  margin: "1px 4px",
  borderRadius: 4,
  cursor: "default",
  transition: "background 0.15s",
};

const itemActiveStyle: React.CSSProperties = {
  background: "rgba(74, 222, 128, 0.08)",
};

const itemContentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  cursor: "pointer",
};

const itemNameStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#e0e0e0",
  fontWeight: 500,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const itemCommandStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  fontFamily: "monospace",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  marginTop: 2,
};

const itemActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  flexShrink: 0,
  marginLeft: 8,
};

const pasteBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#4ade80",
  fontSize: 12,
  padding: "4px 6px",
  borderRadius: 3,
  cursor: "pointer",
};

const editBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#888",
  fontSize: 12,
  padding: "4px 6px",
  borderRadius: 3,
  cursor: "pointer",
};

const deleteBtnStyle: React.CSSProperties = {
  background: "transparent",
  color: "#666",
  fontSize: 11,
  padding: "4px 6px",
  borderRadius: 3,
  cursor: "pointer",
};

export default CommandManagerDrawer;

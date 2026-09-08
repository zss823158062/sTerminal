import { useLayoutStore } from "../store/layoutStore";

/**
 * Claude 会话 ID 形状校验。
 *
 * sessionId 来自磁盘上的 jsonl 文件名，会被拼进 shell 命令，因此先约束为
 * 标准 UUID 形状，避免异常文件名带入 shell 元字符。
 */
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 在指定面板新开一个 Tab 并自动恢复给定的 Claude 会话。
 *
 * 恢复命令写入 transientStartupCommand 而非 startupCommand：它只对本次终端
 * 创建有意义，保存布局时会被剥离，避免下次加载布局重复恢复过期会话。
 *
 * @returns 新建 Tab 的 session ID；sessionId 格式非法时返回 null
 */
export function openClaudeSessionInNewTab(
  leafId: string,
  sessionId: string,
  config: {
    workingDirectory: string;
    shellType?: string;
    shellPath?: string;
  }
): string | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) return null;

  return useLayoutStore.getState().addTab(leafId, {
    workingDirectory: config.workingDirectory,
    ...(config.shellType ? { shellType: config.shellType } : {}),
    ...(config.shellPath ? { shellPath: config.shellPath } : {}),
    transientStartupCommand: `claude --resume ${sessionId}`,
  });
}

import { invoke } from "@tauri-apps/api/core";
import type { ClaudeSessionMeta, ActiveClaudeSession } from "../types/claude";

/**
 * 列出指定工作目录下的 Claude Code 历史会话
 *
 * @param cwd 目标工作目录绝对路径，通常取面板的运行时 CWD
 * @returns 按最后活动时间降序的会话列表；该目录从未跑过 Claude 时返回空数组
 */
export async function claudeSessionsList(
  cwd: string
): Promise<ClaudeSessionMeta[]> {
  return invoke("claude_sessions_list", { cwd });
}

/**
 * 列出所有运行中的 Claude 进程状态
 *
 * @returns 按最后更新时间降序的活跃会话列表
 */
export async function claudeActiveSessions(): Promise<ActiveClaudeSession[]> {
  return invoke("claude_active_sessions");
}

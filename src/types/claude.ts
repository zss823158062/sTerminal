/**
 * Claude Code 会话相关类型
 *
 * 数据由 Rust 侧从 ~/.claude 下的文件读出，本文件与 commands/claude.rs 的
 * ClaudeSessionMeta / ActiveClaudeSession 一一对应。
 */

/** 单条历史会话的元信息（不含消息正文） */
export interface ClaudeSessionMeta {
  /** 会话 UUID，即 jsonl 文件名，可直接传给 claude --resume */
  sessionId: string;
  /** 显示标题：Claude Code 生成的 aiTitle 优先，回退到最后一条用户输入 */
  title: string;
  /** 最后一条用户输入，作副标题（后端已截断至 300 字符） */
  lastPrompt: string;
  /** jsonl 内记录的真实工作目录 */
  cwd: string;
  /** 会话开始时所在的 git 分支 */
  gitBranch: string;
  /** 首条记录时间，ISO 8601；可能为空 */
  startedAt: string;
  /** 文件 mtime 毫秒时间戳，作为最后活动时间 */
  updatedAt: number;
  /** jsonl 文件字节数 */
  sizeBytes: number;
}

/** 运行中的 Claude 进程状态 */
export interface ActiveClaudeSession {
  sessionId: string;
  pid: number;
  cwd: string;
  /** idle | busy | waiting */
  status: string;
  /** status 为 waiting 时的等待原因，如 "permission prompt" */
  waitingFor: string;
  /** Claude Code 派生的会话名，如 "sterminal-2b" */
  name: string;
  updatedAt: number;
}

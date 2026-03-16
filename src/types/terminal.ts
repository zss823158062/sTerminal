/**
 * 运行时面板状态（仅存在于内存，不持久化）
 */
export interface PanelState {
  /** 终端会话唯一 ID，与 TerminalSession.id 保持一致 */
  id: string;
  /**
   * 由 Rust 后端 terminal_create 返回的终端 ID
   * 与面板 ID 一一对应，用于 invoke 调用时索引 PTY 进程
   */
  terminalId: string;
  /** PTY 子进程的操作系统 PID，用于调试和显示 */
  pid: number;
  /**
   * 终端实时工作目录
   * 通过 terminal_get_cwd 查询更新，初始值为 TerminalSession.workingDirectory
   */
  currentWorkingDirectory: string;
  /** PTY 进程是否存活；false 时显示"进程已退出"提示 */
  isAlive: boolean;
  /** 进程退出码；isAlive 为 false 时有效；0 表示正常退出 */
  exitCode?: number;
}

/**
 * Shell 类型信息（由后端 shell_list_available 返回）
 */
export interface ShellInfo {
  /** Shell 类型标识符，小写无空格，如 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'git-bash' */
  type: string;
  /** Shell 可显示名称，如 'PowerShell 7' | 'Command Prompt' */
  displayName: string;
  /** Shell 可执行文件完整绝对路径 */
  path: string;
  /** 是否为系统默认 Shell */
  isDefault: boolean;
}

/**
 * terminal:output 事件 Payload
 */
export interface TerminalOutputEvent {
  /** 产生输出的终端 ID（对应 PanelState.terminalId） */
  terminalId: string;
  /** PTY 输出的原始字节（JSON 序列化为 number 数组） */
  data: number[];
}

/**
 * terminal:exit 事件 Payload
 */
export interface TerminalExitEvent {
  /** 退出的终端 ID */
  terminalId: string;
  /** 进程退出码；0 表示正常退出 */
  exitCode: number;
}

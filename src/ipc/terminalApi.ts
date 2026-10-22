import { invoke, type Channel } from "@tauri-apps/api/core";
import type { ShellInfo, TerminalCreated } from "../types/terminal";

/**
 * 创建 PTY 进程
 *
 * @param shellPath Shell 可执行文件完整路径；为空时由后端探测系统默认 Shell
 * @param workingDirectory 初始工作目录绝对路径
 * @param cols 列数，范围 [10, 512]
 * @param rows 行数，范围 [5, 256]
 * @param onOutput PTY 输出通道（原始字节，按序到达）。须在调用前设好 onmessage，
 *   PTY 一启动就会开始输出
 * @param env 追加到继承环境之上的变量（代理等），可省略
 * @param elevated 是否经 sudo 以管理员身份运行
 * @returns 终端 ID + 实际启动的 shell 路径
 */
export async function terminalCreate(
  shellPath: string,
  workingDirectory: string,
  cols: number,
  rows: number,
  onOutput: Channel<ArrayBuffer>,
  env?: Record<string, string>,
  elevated?: boolean
): Promise<TerminalCreated> {
  return invoke("terminal_create", {
    shellPath,
    workingDirectory,
    cols,
    rows,
    env,
    elevated,
    onOutput,
  });
}

/**
 * 向指定终端的 PTY 进程写入数据（用户键盘输入）
 *
 * @param terminalId 目标终端 ID，必须是 terminalCreate 返回的有效 ID
 * @param data 要写入的字节序列（键盘输入、控制字符等）
 */
export async function terminalWrite(
  terminalId: string,
  data: Uint8Array
): Promise<void> {
  return invoke("terminal_write", {
    terminalId,
    data: Array.from(data),
  });
}

/**
 * 调整指定终端的 PTY 窗口大小，同步发送 SIGWINCH 信号
 *
 * @param terminalId 目标终端 ID
 * @param cols 新的列数，范围 [10, 512]
 * @param rows 新的行数，范围 [5, 256]
 */
export async function terminalResize(
  terminalId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("terminal_resize", { terminalId, cols, rows });
}

/**
 * 终止指定终端的 PTY 进程并从注册表中移除
 *
 * @param terminalId 要终止的终端 ID
 */
export async function terminalKill(terminalId: string): Promise<void> {
  return invoke("terminal_kill", { terminalId });
}

/**
 * 获取指定终端进程的当前工作目录
 *
 * @param terminalId 目标终端 ID
 * @returns 当前工作目录绝对路径；失败时调用方应使用面板记录的初始目录作为回退
 */
export async function terminalGetCwd(terminalId: string): Promise<string> {
  return invoke("terminal_get_cwd", { terminalId });
}

/**
 * 获取 CLI 启动目录（consume-once：首次调用返回路径，后续返回 null）
 */
export async function getStartupDir(): Promise<string | null> {
  return invoke("get_startup_dir");
}

/**
 * 获取 Windows 构建号（如 26100），用于配置 xterm 的 ConPTY 兼容行为
 *
 * @returns 构建号；非 Windows 平台为 null
 */
export async function windowsBuildNumber(): Promise<number | null> {
  return invoke("windows_build_number");
}

/**
 * 列出当前系统上可用的 Shell 可执行路径列表
 *
 * @returns 可用 Shell 列表（至少包含系统默认 Shell）
 */
export async function shellListAvailable(): Promise<ShellInfo[]> {
  return invoke("shell_list_available");
}

/**
 * 当前 sTerminal 进程是否以管理员身份运行
 */
export async function isElevated(): Promise<boolean> {
  return invoke("is_elevated");
}

/**
 * 以管理员身份重启 sTerminal（触发 UAC）。成功时当前进程直接退出；
 * 用户在 UAC 中取消则 reject，当前进程保留。
 *
 * @param cwd 新实例的初始工作目录
 */
export async function restartAsAdmin(cwd?: string): Promise<void> {
  return invoke("restart_as_admin", { cwd });
}

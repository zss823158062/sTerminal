import { invoke } from "@tauri-apps/api/core";
import type { ShellInfo } from "../types/terminal";

/**
 * 创建 PTY 进程，返回分配的终端 ID
 *
 * @param shellPath Shell 可执行文件完整路径
 * @param workingDirectory 初始工作目录绝对路径
 * @param cols 列数，范围 [10, 512]
 * @param rows 行数，范围 [5, 256]
 * @returns 新建终端的唯一 ID（UUID v4 格式）
 */
export async function terminalCreate(
  shellPath: string,
  workingDirectory: string,
  cols: number,
  rows: number
): Promise<string> {
  return invoke("terminal_create", { shellPath, workingDirectory, cols, rows });
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
 * 列出当前系统上可用的 Shell 可执行路径列表
 *
 * @returns 可用 Shell 列表（至少包含系统默认 Shell）
 */
export async function shellListAvailable(): Promise<ShellInfo[]> {
  return invoke("shell_list_available");
}

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::pty::manager::PtyManager;

// ============================================================
// 数据结构定义（对应前端 ShellInfo / TerminalOutputEvent / TerminalExitEvent）
// ============================================================

/// Shell 信息，对应前端 ShellInfo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellInfo {
    /// Shell 类型标识符，小写，如 "powershell" | "cmd" | "bash" | "zsh"
    #[serde(rename = "type")]
    pub shell_type: String,
    /// 用户可见的显示名称，如 "PowerShell 7"
    #[serde(rename = "displayName")]
    pub display_name: String,
    /// Shell 可执行文件完整绝对路径
    pub path: String,
    /// 是否为系统默认 Shell
    #[serde(rename = "isDefault")]
    pub is_default: bool,
}

/// terminal:output 事件 Payload，对应前端 TerminalOutputEvent
#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutputEvent {
    /// 产生输出的终端 ID
    #[serde(rename = "terminalId")]
    pub terminal_id: String,
    /// PTY 输出字节数组（JSON 序列化为 number[]）
    pub data: Vec<u8>,
}

/// terminal:exit 事件 Payload，对应前端 TerminalExitEvent
#[derive(Debug, Clone, Serialize)]
pub struct TerminalExitEvent {
    /// 退出的终端 ID
    #[serde(rename = "terminalId")]
    pub terminal_id: String,
    /// 进程退出码；0 表示正常退出
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
}

// ============================================================
// Tauri Commands（DEV-A 负责 terminal_create / terminal_kill）
// ============================================================

/// 创建一个新的 PTY 进程，返回分配的终端 ID
///
/// # 参数
/// - `shell_path`: Shell 可执行文件的完整路径
/// - `working_directory`: 初始工作目录的绝对路径；若目录不存在则回退到用户 Home 目录
/// - `cols`: 终端列数，最小 10，最大 512
/// - `rows`: 终端行数，最小 5，最大 256
///
/// # 返回
/// - `Ok(String)`: 新建终端的唯一 ID（UUID v4 格式）
/// - `Err(String)`: 错误原因描述（如 shell 不存在、PTY 创建失败）
#[tauri::command]
pub async fn terminal_create(
    shell_path: String,
    working_directory: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
    state: State<'_, PtyManager>,
) -> Result<String, String> {
    state.create(shell_path, working_directory, cols, rows, app).await
}

/// 向指定终端的 PTY 进程写入数据（用户键盘输入）
/// DEV-B 实现：补全 PtyManager::write 调用
#[tauri::command]
pub async fn terminal_write(
    terminal_id: String,
    data: Vec<u8>,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    state.write(&terminal_id, data).await
}

/// 调整指定终端的 PTY 窗口大小，同步发送 SIGWINCH 信号
/// DEV-B 实现：补全 PtyManager::resize 调用
#[tauri::command]
pub async fn terminal_resize(
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    state.resize(&terminal_id, cols, rows).await
}

/// 终止指定终端的 PTY 进程并从注册表中移除
#[tauri::command]
pub async fn terminal_kill(
    terminal_id: String,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    state.kill(&terminal_id).await
}

/// 获取指定终端进程的当前工作目录
/// DEV-B 实现：补全 PtyManager::get_cwd 调用
#[tauri::command]
pub async fn terminal_get_cwd(
    terminal_id: String,
    state: State<'_, PtyManager>,
) -> Result<String, String> {
    state.get_cwd(&terminal_id).await
}

/// 列出当前系统上可用的 Shell 可执行路径列表
/// DEV-B 实现：调用 shell::detector::detect_available_shells
#[tauri::command]
pub async fn shell_list_available() -> Result<Vec<ShellInfo>, String> {
    let shells = crate::shell::detector::detect_available_shells()?;
    Ok(shells
        .into_iter()
        .map(|s| ShellInfo {
            shell_type: s.shell_type,
            display_name: s.display_name,
            path: s.path,
            is_default: s.is_default,
        })
        .collect())
}

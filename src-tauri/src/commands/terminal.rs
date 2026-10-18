use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::pty::manager::PtyManager;

// ============================================================
// 数据结构定义（对应前端 ShellInfo / TerminalExitEvent）
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

/// terminal_create 的返回值，对应前端 TerminalCreated
#[derive(Debug, Clone, Serialize)]
pub struct TerminalCreated {
    /// 新建终端的唯一 ID（UUID v4）
    #[serde(rename = "terminalId")]
    pub terminal_id: String,
    /// 实际启动的 shell 可执行文件路径。
    /// 请求时 shell_path 为空则为后端探测出的系统默认 shell
    #[serde(rename = "shellPath")]
    pub shell_path: String,
}

// ============================================================
// Tauri Commands（DEV-A 负责 terminal_create / terminal_kill）
// ============================================================

/// 创建一个新的 PTY 进程，返回终端 ID 和实际启动的 shell 路径
///
/// # 参数
/// - `shell_path`: Shell 可执行文件的完整路径；为空时探测系统默认 Shell
/// - `working_directory`: 初始工作目录的绝对路径；若目录不存在则回退到用户 Home 目录
/// - `cols`: 终端列数，最小 10，最大 512
/// - `rows`: 终端行数，最小 5，最大 256
/// - `env`: 追加到继承环境之上的变量（代理等），可省略
/// - `on_output`: 前端创建的输出通道，PTY 输出以原始字节写入
///
/// # 返回
/// - `Ok(TerminalCreated)`: 终端 ID + 实际使用的 shell 路径
/// - `Err(String)`: 错误原因描述（如 shell 不存在、PTY 创建失败）
#[tauri::command]
pub async fn terminal_create(
    shell_path: String,
    working_directory: String,
    cols: u16,
    rows: u16,
    env: Option<HashMap<String, String>>,
    on_output: Channel,
    app: AppHandle,
    state: State<'_, PtyManager>,
) -> Result<TerminalCreated, String> {
    let (terminal_id, effective_shell) = state
        .create(
            shell_path,
            working_directory,
            cols,
            rows,
            env.unwrap_or_default(),
            on_output,
            app,
        )
        .await?;
    Ok(TerminalCreated {
        terminal_id,
        shell_path: effective_shell,
    })
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

/// 获取 CLI 启动目录（consume-once：首次调用返回路径，后续返回 null）
#[tauri::command]
pub fn get_startup_dir(state: State<'_, crate::StartupDir>) -> Option<String> {
    state.0.lock().ok().and_then(|mut dir| dir.take())
}

/// 获取 Windows 构建号（如 26100），非 Windows 返回 None
///
/// 前端据此设置 xterm 的 windowsPty，让 xterm 按 ConPTY 的行为处理
/// resize 与换行。用 RtlGetVersion 而非 GetVersionEx：后者受应用清单的
/// 兼容性声明影响，可能返回假版本号。
#[tauri::command]
pub fn windows_build_number() -> Option<u32> {
    #[cfg(target_os = "windows")]
    {
        win_version::build_number()
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}

#[cfg(target_os = "windows")]
mod win_version {
    /// RTL_OSVERSIONINFOW（只读 build_number，其余字段仅用于对齐内存布局）
    #[allow(dead_code)]
    #[repr(C)]
    struct OsVersionInfo {
        size: u32,
        major_version: u32,
        minor_version: u32,
        build_number: u32,
        platform_id: u32,
        csd_version: [u16; 128],
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
    }

    pub fn build_number() -> Option<u32> {
        unsafe {
            let mut info: OsVersionInfo = std::mem::zeroed();
            info.size = std::mem::size_of::<OsVersionInfo>() as u32;
            // NTSTATUS 0 = STATUS_SUCCESS
            if RtlGetVersion(&mut info) == 0 {
                Some(info.build_number)
            } else {
                None
            }
        }
    }
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

/// 可探测到的 Shell 信息
#[derive(Debug, Clone)]
pub struct DetectedShell {
    /// Shell 类型标识符，小写，如 "powershell" | "cmd" | "bash" | "zsh"
    pub shell_type: String,
    /// 用户可见显示名称
    pub display_name: String,
    /// Shell 可执行文件完整绝对路径
    pub path: String,
    /// 是否为系统默认 Shell
    pub is_default: bool,
}

/// 按平台探测当前系统可用的 Shell 列表
///
/// - Windows：探测 PowerShell 5.1 / PowerShell 7 / CMD / Git Bash
/// - macOS / Linux：探测 Bash / Zsh / Fish
///
/// # 返回
/// - `Ok(Vec<DetectedShell>)`: 至少包含一个系统默认 Shell
/// - `Err(String)`: 探测完全失败（极少见）
///
/// DEV-B 负责完整实现
pub fn detect_available_shells() -> Result<Vec<DetectedShell>, String> {
    todo!("DEV-B 实现：按平台探测可用 Shell 列表")
}

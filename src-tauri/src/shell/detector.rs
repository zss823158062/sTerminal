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
    /// 是否经 sudo 以管理员身份运行
    pub elevated: bool,
}

/// 按平台探测当前系统可用的 Shell 列表
///
/// - Windows：探测 PowerShell 5.1 / PowerShell 7 / CMD / Git Bash
/// - macOS / Linux：探测 Bash / Zsh / Fish
///
/// # 返回
/// - `Ok(Vec<DetectedShell>)`: 实际存在的 Shell 列表
/// - `Err(String)`: 探测完全失败（极少见）
pub fn detect_available_shells() -> Result<Vec<DetectedShell>, String> {
    let mut shells = Vec::new();

    #[cfg(target_os = "windows")]
    detect_windows_shells(&mut shells);

    #[cfg(not(target_os = "windows"))]
    detect_unix_shells(&mut shells);

    // 至少保证返回一个 Shell；若列表为空尝试 fallback
    if shells.is_empty() {
        return Err("No available shells detected on this system".to_string());
    }

    Ok(shells)
}

/// Windows 平台 Shell 探测
#[cfg(target_os = "windows")]
fn detect_windows_shells(shells: &mut Vec<DetectedShell>) {
    // 候选列表：(shell_type, display_name, path, is_default)
    let candidates: &[(&str, &str, &str, bool)] = &[
        (
            "powershell",
            "PowerShell 5.1",
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            true,
        ),
        (
            "pwsh",
            "PowerShell 7",
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            false,
        ),
        (
            "cmd",
            "Command Prompt",
            r"C:\Windows\System32\cmd.exe",
            false,
        ),
        (
            "git-bash",
            "Git Bash",
            r"C:\Program Files\Git\bin\bash.exe",
            false,
        ),
    ];

    for (shell_type, display_name, path, is_default) in candidates {
        if std::path::Path::new(path).exists() {
            shells.push(DetectedShell {
                shell_type: shell_type.to_string(),
                display_name: display_name.to_string(),
                path: path.to_string(),
                is_default: *is_default,
                elevated: false,
            });
        }
    }

    // 若 PowerShell 5.1 不存在（极罕见），则将第一个探测到的设为默认
    if !shells.is_empty() && !shells.iter().any(|s| s.is_default) {
        shells[0].is_default = true;
    }

    // sudo 内联模式可用时追加管理员变体（Git Bash 提权意义不大，不列出）；
    // 本进程已提权时所有终端本就是管理员，无需变体
    if super::elevation::sudo_inline_available() && !super::elevation::is_elevated() {
        let admin: Vec<DetectedShell> = shells
            .iter()
            .filter(|s| matches!(s.shell_type.as_str(), "powershell" | "pwsh" | "cmd"))
            .map(|s| DetectedShell {
                display_name: format!("{}（管理员）", s.display_name),
                is_default: false,
                elevated: true,
                ..s.clone()
            })
            .collect();
        shells.extend(admin);
    }
}

/// Unix 平台（Linux/macOS）Shell 探测
#[cfg(not(target_os = "windows"))]
fn detect_unix_shells(shells: &mut Vec<DetectedShell>) {
    let candidates: &[(&str, &str, &str)] = &[
        ("bash", "Bash", "/bin/bash"),
        ("zsh", "Zsh", "/bin/zsh"),
        ("fish", "Fish", "/usr/bin/fish"),
        ("bash", "Bash", "/usr/bin/bash"),
        ("zsh", "Zsh", "/usr/bin/zsh"),
    ];

    for (shell_type, display_name, path) in candidates {
        // 避免重复添加同类型 Shell
        if std::path::Path::new(path).exists()
            && !shells.iter().any(|s: &DetectedShell| s.shell_type == *shell_type)
        {
            shells.push(DetectedShell {
                shell_type: shell_type.to_string(),
                display_name: display_name.to_string(),
                path: path.to_string(),
                is_default: false,
                elevated: false,
            });
        }
    }

    // 按优先级设置默认 Shell：zsh > bash > fish
    let default_priority = ["zsh", "bash", "fish"];
    let mut default_set = false;
    for preferred in &default_priority {
        if let Some(s) = shells.iter_mut().find(|s| s.shell_type == *preferred) {
            s.is_default = true;
            default_set = true;
            break;
        }
    }
    // 回退：将第一个设为默认
    if !default_set && !shells.is_empty() {
        shells[0].is_default = true;
    }
}

//! 管理员权限相关：提权状态检测、Windows sudo 内联模式探测
//!
//! 未提权进程无法在自己的 ConPTY 里直接启动管理员子进程（UAC 只能通过
//! ShellExecute "runas" 提权，而提权进程会另开控制台窗口）。两条出路：
//!
//! - 以管理员身份重启整个 sTerminal（所有标签都提权）
//! - Windows 11 24H2+ 自带的 `sudo` 处于内联模式时，提权进程会挂到
//!   调用者的控制台上，可以嵌在 PTY 里运行（每个标签单独弹 UAC）

/// Windows 自带 sudo 的固定路径
#[cfg(target_os = "windows")]
pub const SUDO_PATH: &str = r"C:\Windows\System32\sudo.exe";

/// 当前进程是否已以管理员身份运行
#[cfg(target_os = "windows")]
pub fn is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(target_os = "windows"))]
pub fn is_elevated() -> bool {
    false
}

/// sudo 是否可用于嵌入式管理员终端：sudo.exe 存在且配置为内联模式
///
/// 注册表 `HKLM\...\CurrentVersion\Sudo\Enabled`：
/// 0 禁用 / 1 新窗口 / 2 禁用输入 / 3 内联。只有内联模式能把提权进程
/// 接到我们的 ConPTY 上，其余模式会弹出独立窗口或无法交互。
#[cfg(target_os = "windows")]
pub fn sudo_inline_available() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};

    if !std::path::Path::new(SUDO_PATH).exists() {
        return false;
    }

    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\Sudo"),
            w!("Enabled"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut _ as *mut _),
            Some(&mut size),
        )
    };
    status.is_ok() && value == 3
}

/// 以管理员身份启动自身（触发 UAC），`dir` 作为新实例的初始目录
///
/// 用户在 UAC 中取消时返回 Err，调用方据此决定是否退出当前进程。
#[cfg(target_os = "windows")]
pub fn relaunch_as_admin(dir: Option<&str>) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{w, PCWSTR};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
        s.encode_wide().chain(std::iter::once(0)).collect()
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_w = wide(exe.as_os_str());
    let params = match dir.filter(|d| !d.is_empty()) {
        Some(d) => format!("--dir \"{}\"", d),
        None => String::new(),
    };
    let params_w = wide(std::ffi::OsStr::new(&params));

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        lpVerb: w!("runas"),
        lpFile: PCWSTR(exe_w.as_ptr()),
        lpParameters: PCWSTR(params_w.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    unsafe { ShellExecuteExW(&mut info) }.map_err(|e| format!("以管理员身份启动失败：{}", e))
}

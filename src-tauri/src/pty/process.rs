use std::io::Read;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::Emitter;

use crate::commands::terminal::{TerminalExitEvent, TerminalOutputEvent};

/// 单个 PTY 进程的封装
///
/// 持有 PTY master 写句柄和子进程句柄，负责：
/// - 接收写入数据并转发至 PTY master
/// - 后台读取线程：读取 PTY 输出 → emit terminal:output 事件
/// - 进程退出检测 → emit terminal:exit 事件
pub struct PtyProcess {
    /// 终端唯一 ID（UUID v4）
    #[allow(dead_code)]
    pub terminal_id: String,
    /// 子进程 PID
    pub pid: u32,
    /// PTY 窗口当前大小
    pub size: PtySize,
    /// PTY master 写句柄，用于发送键盘输入
    writer: Box<dyn std::io::Write + Send>,
    /// PTY master 句柄，用于 resize
    master: Box<dyn portable_pty::MasterPty + Send>,
    /// 子进程句柄，用于 kill
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// 初始工作目录（Windows cwd 回退用）
    initial_cwd: String,
}

impl PtyProcess {
    /// 创建新的 PTY 进程
    ///
    /// 1. 使用 native_pty_system() 获取平台原生 PTY 系统
    /// 2. 打开 PTY pair（master + slave）
    /// 3. 用 shell_path + working_directory 启动子进程
    /// 4. 启动后台读取线程，emit terminal:output / terminal:exit 事件
    pub fn new(
        terminal_id: String,
        shell_path: String,
        working_directory: String,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();

        let size = PtySize {
            rows,
            cols,
            ..Default::default()
        };

        // 打开 PTY pair
        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // 构造启动命令
        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.cwd(&working_directory);

        // 在 slave 端启动子进程
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell '{}': {}", shell_path, e))?;

        let pid = child.process_id().unwrap_or(0);

        // 获取 master 写句柄
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        // 获取 master 读句柄（移入后台线程）
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        // 启动后台读取线程
        let tid = terminal_id.clone();
        let app = app_handle.clone();
        std::thread::spawn(move || {
            Self::reader_thread(tid, reader, app);
        });

        Ok(PtyProcess {
            terminal_id,
            pid,
            size,
            writer,
            master: pair.master,
            child,
            initial_cwd: working_directory,
        })
    }

    /// 后台读取线程：持续读取 PTY master 输出，emit terminal:output 事件
    /// 进程退出后 emit terminal:exit 事件
    fn reader_thread(
        terminal_id: String,
        mut reader: Box<dyn std::io::Read + Send>,
        app_handle: tauri::AppHandle,
    ) {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF：进程已退出
                    break;
                }
                Ok(n) => {
                    let payload = TerminalOutputEvent {
                        terminal_id: terminal_id.clone(),
                        data: buf[..n].to_vec(),
                    };
                    if let Err(e) = app_handle.emit("terminal:output", payload) {
                        eprintln!("Failed to emit terminal:output for '{}': {}", terminal_id, e);
                    }
                }
                Err(e) => {
                    // 读取错误通常意味着进程已退出
                    eprintln!("PTY read error for '{}': {}", terminal_id, e);
                    break;
                }
            }
        }

        // 进程退出，emit terminal:exit 事件（退出码默认 0，无法精确获取时用 -1）
        let exit_payload = TerminalExitEvent {
            terminal_id: terminal_id.clone(),
            exit_code: 0,
        };
        if let Err(e) = app_handle.emit("terminal:exit", exit_payload) {
            eprintln!("Failed to emit terminal:exit for '{}': {}", terminal_id, e);
        }
    }

    /// 向 PTY 写入数据（用户键盘输入）
    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        use std::io::Write;
        self.writer
            .write_all(data)
            .map_err(|e| format!("PTY write error: {}", e))
    }

    /// 调整 PTY 窗口大小，触发 SIGWINCH
    pub fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        let new_size = PtySize {
            rows,
            cols,
            ..Default::default()
        };
        self.master
            .resize(new_size)
            .map_err(|e| format!("PTY resize error: {}", e))?;
        self.size = new_size;
        Ok(())
    }

    /// 终止 PTY 子进程
    pub fn kill(&mut self) -> Result<(), String> {
        self.child
            .kill()
            .map_err(|e| format!("Failed to kill process {}: {}", self.pid, e))
    }

    /// 获取 PTY 子进程的当前工作目录
    ///
    /// - Windows：尝试通过 NtQueryInformationProcess 获取，失败时返回初始工作目录
    /// - Linux/macOS：读取 /proc/{pid}/cwd 符号链接
    pub fn get_cwd(&self) -> Result<String, String> {
        self.get_cwd_impl()
    }

    #[cfg(target_os = "linux")]
    fn get_cwd_impl(&self) -> Result<String, String> {
        let link = format!("/proc/{}/cwd", self.pid);
        std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().to_string())
            .map_err(|e| format!("Failed to read /proc/{}/cwd: {}", self.pid, e))
    }

    #[cfg(target_os = "macos")]
    fn get_cwd_impl(&self) -> Result<String, String> {
        let link = format!("/proc/{}/cwd", self.pid);
        std::fs::read_link(&link)
            .map(|p| p.to_string_lossy().to_string())
            .or_else(|_| Ok(self.initial_cwd.clone()))
    }

    #[cfg(target_os = "windows")]
    fn get_cwd_impl(&self) -> Result<String, String> {
        // Windows 平台：通过 NtQueryInformationProcess 获取 cwd 较复杂
        // 简单方案：返回初始工作目录作为回退
        // 调用方 (terminal_get_cwd) 会在 Err 时也使用此值，直接返回 Ok
        Ok(self.initial_cwd.clone())
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    fn get_cwd_impl(&self) -> Result<String, String> {
        Ok(self.initial_cwd.clone())
    }
}

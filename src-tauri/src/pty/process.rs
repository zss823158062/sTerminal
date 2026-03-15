use portable_pty::PtySize;

/// 单个 PTY 进程的封装
///
/// 持有 PTY master 句柄和子进程，负责：
/// - 接收写入数据并转发至 PTY master
/// - 后台读取线程：读取 PTY 输出 → emit terminal:output 事件
/// - 进程退出检测 → emit terminal:exit 事件
///
/// DEV-B 负责完整实现
pub struct PtyProcess {
    /// 终端唯一 ID（UUID v4）
    pub terminal_id: String,
    /// 子进程 PID
    pub pid: u32,
    /// PTY 窗口当前大小
    pub size: PtySize,
    // 内部字段由 DEV-B 实现时添加：
    // - master: Box<dyn portable_pty::MasterPty + Send>
    // - child: Box<dyn portable_pty::Child + Send + Sync>
    // - writer: Box<dyn std::io::Write + Send>
}

impl PtyProcess {
    /// 创建新的 PTY 进程
    ///
    /// DEV-B 实现：
    /// 1. 使用 portable_pty::native_pty_system() 获取 PTY 系统
    /// 2. 打开 PTY pair（master + slave）
    /// 3. 用 shell_path + working_directory 启动子进程
    /// 4. 启动后台读取线程，emit terminal:output / terminal:exit 事件
    pub fn new(
        _terminal_id: String,
        _shell_path: String,
        _working_directory: String,
        _cols: u16,
        _rows: u16,
        _app_handle: tauri::AppHandle,
    ) -> Result<Self, String> {
        todo!("DEV-B 实现：创建 PTY 进程，启动后台读取线程")
    }

    /// 向 PTY 写入数据（用户键盘输入）
    ///
    /// DEV-B 实现：将 data 写入 master writer
    pub fn write(&mut self, _data: &[u8]) -> Result<(), String> {
        todo!("DEV-B 实现：向 PTY master 写入数据")
    }

    /// 调整 PTY 窗口大小
    ///
    /// DEV-B 实现：调用 master.resize(PtySize { rows, cols, .. })
    pub fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), String> {
        todo!("DEV-B 实现：调整 PTY 窗口大小")
    }

    /// 终止 PTY 子进程
    ///
    /// DEV-B 实现：调用 child.kill()
    pub fn kill(&mut self) -> Result<(), String> {
        todo!("DEV-B 实现：终止 PTY 子进程")
    }

    /// 获取 PTY 子进程的当前工作目录
    ///
    /// DEV-B 实现：
    /// - Windows: 通过 NtQueryInformationProcess 或 QueryFullProcessImageName 获取
    /// - Linux: 读取 /proc/{pid}/cwd 符号链接
    /// - macOS: 使用 proc_pidinfo + PROC_PIDVNODEPATHINFO
    pub fn get_cwd(&self) -> Result<String, String> {
        todo!("DEV-B 实现：获取 PTY 子进程当前工作目录")
    }
}

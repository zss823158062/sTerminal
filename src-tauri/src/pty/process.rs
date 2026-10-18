use std::collections::HashMap;
use std::io::Read;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Emitter;

use crate::commands::terminal::TerminalExitEvent;

/// 单个 PTY 进程的封装
///
/// 持有 PTY master 写句柄和子进程句柄，负责：
/// - 接收写入数据并转发至 PTY master
/// - 后台读取线程：读取 PTY 输出 → 发送到该终端专属的 output Channel
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
    /// 4. 启动后台读取线程，输出写入 `output` Channel，退出时 emit terminal:exit
    ///
    /// `extra_env` 中的变量会追加到继承环境之上（如代理变量），同名时覆盖。
    ///
    /// `output` 由前端在调用前创建，因此读取线程的第一包数据就有接收方；
    /// 若改用全局事件广播，前端 listen 注册完成前发出的输出会被直接丢弃，
    /// ConPTY 此后只发增量，xterm 的屏幕状态会从第一帧起就与之不一致。
    pub fn new(
        terminal_id: String,
        shell_path: String,
        working_directory: String,
        cols: u16,
        rows: u16,
        extra_env: HashMap<String, String>,
        output: Channel,
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

        // 设置 TERM 环境变量，确保 shell 正确识别终端能力（键绑定、颜色等）
        // macOS 从 Dock 启动时继承的是 launchd 的最小环境，不包含 TERM
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // 调用方追加的环境变量（代理等），放在最后以便覆盖上面的默认值
        for (key, value) in &extra_env {
            cmd.env(key, value);
        }

        // 注入 OSC 133 shell 集成：不修改用户配置文件，只附加启动参数/环境变量。
        // 不支持的 shell（如 cmd）返回 None，前端会自动回退到静止超时判断。
        let integration = crate::shell::integration::setup(&shell_path);
        if let Some(ref integ) = integration {
            for (key, value) in &integ.envs {
                cmd.env(key, value);
            }
        }

        // Unix 下以 login shell 启动，确保加载用户配置（~/.zshrc 等）。
        // bash 注入走 --rcfile，而登录模式会忽略它（实测 5.2），因此跳过 -l，
        // 由注入脚本自行模拟登录时的加载顺序。
        #[cfg(not(target_os = "windows"))]
        {
            let lower = shell_path.to_lowercase();
            let bash_uses_rcfile = integration
                .as_ref()
                .is_some_and(|i| i.args.iter().any(|a| a == "--rcfile"));
            if lower.ends_with("bash") {
                if !bash_uses_rcfile {
                    cmd.arg("-l");
                }
            } else if lower.ends_with("zsh") {
                cmd.arg("-l");
            } else if lower.ends_with("fish") {
                cmd.arg("--login");
            }
        }

        if let Some(integ) = integration {
            for arg in integ.args {
                cmd.arg(arg);
            }
        }

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
            Self::reader_thread(tid, reader, output, app);
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

    /// 后台读取线程：持续读取 PTY master 输出，以原始字节发送到 output Channel
    /// （Channel 按序号保序，前端收到 ArrayBuffer）。进程退出后 emit terminal:exit 事件
    fn reader_thread(
        terminal_id: String,
        mut reader: Box<dyn std::io::Read + Send>,
        output: Channel,
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
                    if let Err(e) = output.send(InvokeResponseBody::Raw(buf[..n].to_vec())) {
                        eprintln!("Failed to send output for '{}': {}", terminal_id, e);
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
        if self.pid == 0 {
            return Ok(self.initial_cwd.clone());
        }
        match win_cwd::get_process_cwd(self.pid) {
            Some(cwd) if !cwd.is_empty() => Ok(cwd),
            _ => Ok(self.initial_cwd.clone()),
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    fn get_cwd_impl(&self) -> Result<String, String> {
        Ok(self.initial_cwd.clone())
    }
}

/// Windows 平台：通过 NtQueryInformationProcess + ReadProcessMemory
/// 读取目标进程 PEB 中的 CurrentDirectory，获取运行时 CWD
#[cfg(target_os = "windows")]
mod win_cwd {
    use std::ffi::c_void;
    use std::mem;
    use std::ptr;

    type HANDLE = *mut c_void;

    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    const PROCESS_VM_READ: u32 = 0x0010;

    #[repr(C)]
    struct ProcessBasicInformation {
        reserved1: usize,
        peb_base_address: usize,
        reserved2: [usize; 2],
        unique_process_id: usize,
        reserved3: usize,
    }

    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> HANDLE;
        fn CloseHandle(handle: HANDLE) -> i32;
        fn ReadProcessMemory(
            process: HANDLE,
            base_address: *const c_void,
            buffer: *mut c_void,
            size: usize,
            bytes_read: *mut usize,
        ) -> i32;
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(
            process_handle: HANDLE,
            process_information_class: u32,
            process_information: *mut c_void,
            process_information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }

    /// 从目标进程内存中读取一个 T 类型的值
    unsafe fn read_remote<T>(handle: HANDLE, address: usize) -> Option<T> {
        let mut value: T = mem::zeroed();
        let mut bytes_read: usize = 0;
        let ok = ReadProcessMemory(
            handle,
            address as *const c_void,
            &mut value as *mut T as *mut c_void,
            mem::size_of::<T>(),
            &mut bytes_read,
        );
        if ok != 0 && bytes_read == mem::size_of::<T>() {
            Some(value)
        } else {
            None
        }
    }

    pub fn get_process_cwd(pid: u32) -> Option<String> {
        unsafe {
            let handle =
                OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if handle.is_null() {
                return None;
            }
            let result = read_cwd(handle);
            CloseHandle(handle);
            result
        }
    }

    unsafe fn read_cwd(handle: HANDLE) -> Option<String> {
        // 1) 通过 NtQueryInformationProcess(ProcessBasicInformation) 拿到 PEB 地址
        let mut pbi: ProcessBasicInformation = mem::zeroed();
        let status = NtQueryInformationProcess(
            handle,
            0, // ProcessBasicInformation
            &mut pbi as *mut _ as *mut c_void,
            mem::size_of::<ProcessBasicInformation>() as u32,
            ptr::null_mut(),
        );
        if status != 0 {
            return None;
        }

        // 2) 从 PEB 读取 ProcessParameters 指针
        //    x64: PEB + 0x20   x86: PEB + 0x10
        let params_offset: usize = if mem::size_of::<usize>() == 8 { 0x20 } else { 0x10 };
        let process_params: usize =
            read_remote(handle, pbi.peb_base_address + params_offset)?;

        // 3) 从 RTL_USER_PROCESS_PARAMETERS 读取 CurrentDirectory.DosPath (UNICODE_STRING)
        //    x64: offset 0x38   x86: offset 0x24
        let curdir_offset: usize = if mem::size_of::<usize>() == 8 { 0x38 } else { 0x24 };
        let base = process_params + curdir_offset;

        // UNICODE_STRING.Length (u16)
        let length: u16 = read_remote(handle, base)?;
        if length == 0 {
            return None;
        }

        // UNICODE_STRING.Buffer 指针
        //   x64: 跳过 Length(2) + MaximumLength(2) + padding(4) = +8
        //   x86: 跳过 Length(2) + MaximumLength(2) = +4
        let buf_ptr_offset: usize = if mem::size_of::<usize>() == 8 { 8 } else { 4 };
        let buffer_ptr: usize = read_remote(handle, base + buf_ptr_offset)?;
        if buffer_ptr == 0 {
            return None;
        }

        // 4) 读取路径字符串 (UTF-16)
        let char_count = length as usize / 2;
        let mut buf = vec![0u16; char_count];
        let mut bytes_read: usize = 0;
        let ok = ReadProcessMemory(
            handle,
            buffer_ptr as *const c_void,
            buf.as_mut_ptr() as *mut c_void,
            length as usize,
            &mut bytes_read,
        );
        if ok == 0 {
            return None;
        }

        let path = String::from_utf16_lossy(&buf);
        // 去除末尾反斜杠，但保留盘符根目录如 "C:\"
        let trimmed = path.trim_end_matches('\\');
        if trimmed.len() == 2 && trimmed.as_bytes().get(1) == Some(&b':') {
            Some(format!("{}\\", trimmed))
        } else {
            Some(trimmed.to_string())
        }
    }
}

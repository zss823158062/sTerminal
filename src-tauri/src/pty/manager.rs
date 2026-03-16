use std::collections::HashMap;
use std::sync::Mutex;
use tauri::AppHandle;

use super::process::PtyProcess;

/// PTY 进程注册表，线程安全
///
/// 维护所有活跃 PTY 进程的 HashMap，提供 CRUD 操作。
/// 作为 Tauri 托管状态使用 Mutex 保证并发安全。
///
/// DEV-B 负责完整实现各方法体
pub struct PtyManager {
    /// 进程注册表：terminalId → PtyProcess
    processes: Mutex<HashMap<String, PtyProcess>>,
}

impl PtyManager {
    /// 创建空的 PtyManager
    pub fn new() -> Self {
        PtyManager {
            processes: Mutex::new(HashMap::new()),
        }
    }

    /// 创建新 PTY 进程并注册到注册表
    ///
    /// # 返回
    /// - `Ok(String)`: 新建终端 ID（UUID v4）
    /// - `Err(String)`: 进程创建失败原因
    ///
    /// DEV-B 实现：
    /// 1. 验证 working_directory 是否存在，不存在则回退到 Home 目录
    /// 2. 调用 PtyProcess::new 创建进程
    /// 3. 将进程插入 processes map
    pub async fn create(
        &self,
        shell_path: String,
        working_directory: String,
        cols: u16,
        rows: u16,
        app: AppHandle,
    ) -> Result<String, String> {
        let terminal_id = uuid::Uuid::new_v4().to_string();

        // shell_path 为空时自动检测系统默认 Shell
        let effective_shell = if shell_path.is_empty() {
            let shells = crate::shell::detector::detect_available_shells()?;
            shells
                .iter()
                .find(|s| s.is_default)
                .or(shells.first())
                .map(|s| s.path.clone())
                .ok_or_else(|| "No available shell found on this system".to_string())?
        } else {
            shell_path
        };

        // 验证工作目录是否存在，不存在时回退到 Home 目录
        let effective_dir = if std::path::Path::new(&working_directory).exists() {
            working_directory
        } else {
            dirs_home()
        };

        let process = PtyProcess::new(
            terminal_id.clone(),
            effective_shell,
            effective_dir,
            cols,
            rows,
            app,
        )?;

        self.processes
            .lock()
            .map_err(|e| format!("PtyManager lock error: {}", e))?
            .insert(terminal_id.clone(), process);

        Ok(terminal_id)
    }

    /// 向指定终端写入数据
    ///
    /// DEV-B 实现：从 map 查找进程，调用 process.write(data)
    pub async fn write(&self, terminal_id: &str, data: Vec<u8>) -> Result<(), String> {
        let mut processes = self
            .processes
            .lock()
            .map_err(|e| format!("PtyManager lock error: {}", e))?;
        let process = processes
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Terminal '{}' not found", terminal_id))?;
        process.write(&data)
    }

    /// 调整指定终端大小
    ///
    /// DEV-B 实现：从 map 查找进程，调用 process.resize(cols, rows)
    pub async fn resize(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut processes = self
            .processes
            .lock()
            .map_err(|e| format!("PtyManager lock error: {}", e))?;
        let process = processes
            .get_mut(terminal_id)
            .ok_or_else(|| format!("Terminal '{}' not found", terminal_id))?;
        process.resize(cols, rows)
    }

    /// 终止并移除指定终端
    ///
    /// 幂等操作：终端 ID 不存在时返回 Ok
    pub async fn kill(&self, terminal_id: &str) -> Result<(), String> {
        let mut processes = self
            .processes
            .lock()
            .map_err(|e| format!("PtyManager lock error: {}", e))?;
        if let Some(mut process) = processes.remove(terminal_id) {
            process.kill()?;
        }
        Ok(())
    }

    /// 获取指定终端的当前工作目录
    ///
    /// DEV-B 实现：从 map 查找进程，调用 process.get_cwd()
    pub async fn get_cwd(&self, terminal_id: &str) -> Result<String, String> {
        let processes = self
            .processes
            .lock()
            .map_err(|e| format!("PtyManager lock error: {}", e))?;
        let process = processes
            .get(terminal_id)
            .ok_or_else(|| format!("Terminal '{}' not found", terminal_id))?;
        process.get_cwd()
    }

    /// 终止所有注册的 PTY 进程
    ///
    /// 在窗口关闭时调用，防止孤儿进程泄漏。
    /// 即使部分进程 kill 失败也继续清理其余进程。
    pub fn kill_all(&self) {
        if let Ok(mut processes) = self.processes.lock() {
            for (id, mut process) in processes.drain() {
                if let Err(e) = process.kill() {
                    eprintln!("Failed to kill terminal '{}': {}", id, e);
                }
            }
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}

/// 获取用户 Home 目录路径字符串
fn dirs_home() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string())
}

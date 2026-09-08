mod commands;
mod pty;
mod shell;
mod store;

use std::sync::Mutex;
use tauri::Manager;
use commands::terminal::{
    terminal_create, terminal_kill, terminal_resize, terminal_write, terminal_get_cwd,
    shell_list_available, get_startup_dir,
};
use commands::layout::{
    layout_save, layout_list, layout_load, layout_update, layout_delete, layout_rename,
    settings_get, settings_save,
};
use commands::window::{show_system_menu, spawn_new_window};
use commands::fonts::list_monospace_fonts;
use commands::download::{download_update, open_file};
use commands::claude::{claude_sessions_list, claude_active_sessions};
use pty::manager::PtyManager;

/// CLI 启动目录，consume-once：首次读取后清空
pub struct StartupDir(pub Mutex<Option<String>>);

/// 解析命令行参数中的启动目录
/// 支持: sTerminal.exe "D:\path" 或 sTerminal.exe --dir "D:\path" 或 sTerminal.exe .
fn parse_startup_dir() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        if args[i] == "--dir" {
            if let Some(path) = args.get(i + 1) {
                if let Some(dir) = resolve_dir(path) {
                    return Some(dir);
                }
            }
            i += 2;
        } else if !args[i].starts_with('-') {
            if let Some(dir) = resolve_dir(&args[i]) {
                return Some(dir);
            }
            i += 1;
        } else {
            i += 1;
        }
    }
    None
}

/// 校验并解析目录路径为绝对路径（支持 "." ".." 等相对路径）
fn resolve_dir(path: &str) -> Option<String> {
    let p = std::path::Path::new(path);
    if p.is_dir() {
        p.canonicalize().ok().map(|abs| {
            let s = abs.to_string_lossy().into_owned();
            // Windows canonicalize 返回 \\?\D:\path 格式，去掉 \\?\ 前缀
            s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
        })
    } else {
        None
    }
}

/// Tauri 应用入口，由 main.rs 调用
pub fn run() {
    let startup_dir = parse_startup_dir();

    tauri::Builder::default()
        // 注册 tauri-plugin-store 持久化插件
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // 注册 PtyManager 为全局托管状态（线程安全）
        .manage(PtyManager::new())
        // 注册 CLI 启动目录状态
        .manage(StartupDir(Mutex::new(startup_dir)))
        // 注册所有 Tauri command
        .invoke_handler(tauri::generate_handler![
            // 终端 PTY 命令
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            terminal_get_cwd,
            shell_list_available,
            get_startup_dir,
            // 布局持久化命令
            layout_save,
            layout_list,
            layout_load,
            layout_update,
            layout_delete,
            layout_rename,
            // 设置命令
            settings_get,
            settings_save,
            // 窗口命令
            show_system_menu,
            spawn_new_window,
            // 字体命令
            list_monospace_fonts,
            // 下载命令
            download_update,
            open_file,
            // Claude Code 会话命令
            claude_sessions_list,
            claude_active_sessions,
        ])
        // 设置窗口图标 + 平台适配
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }

                // macOS: 启用原生红绿灯按钮 + Overlay 标题栏
                #[cfg(target_os = "macos")]
                {
                    let _ = window.set_decorations(true);
                    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                }
            }
            Ok(())
        })
        // 窗口关闭时全量清理所有 PTY 进程，防止孤儿进程
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // 获取托管的 PtyManager 并 kill 所有进程
                if let Some(manager) = window.try_state::<PtyManager>() {
                    manager.kill_all();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running sTerminal application");
}

mod commands;
mod pty;
mod shell;
mod store;

use tauri::Manager;
use commands::terminal::{
    terminal_create, terminal_kill, terminal_resize, terminal_write, terminal_get_cwd,
    shell_list_available,
};
use commands::layout::{
    layout_save, layout_list, layout_load, layout_delete, layout_rename,
    settings_get, settings_save,
};
use pty::manager::PtyManager;

/// Tauri 应用入口，由 main.rs 调用
pub fn run() {
    tauri::Builder::default()
        // 注册 tauri-plugin-store 持久化插件
        .plugin(tauri_plugin_store::Builder::new().build())
        // 注册 PtyManager 为全局托管状态（线程安全）
        .manage(PtyManager::new())
        // 注册所有 Tauri command
        .invoke_handler(tauri::generate_handler![
            // 终端 PTY 命令
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            terminal_get_cwd,
            shell_list_available,
            // 布局持久化命令
            layout_save,
            layout_list,
            layout_load,
            layout_delete,
            layout_rename,
            // 设置命令
            settings_get,
            settings_save,
        ])
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

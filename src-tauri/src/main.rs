// 在 Release 构建中隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    s_terminal_lib::run();
}

/// Terminal PTY 命令：create / write / resize / kill / get_cwd
pub mod terminal;

/// 布局持久化命令：save / list / load / delete / rename / settings
pub mod layout;

/// 窗口命令：show_system_menu
pub mod window;

/// 字体命令：list_monospace_fonts
pub mod fonts;

/// 下载命令：download_update / open_file
pub mod download;

/// Claude Code 会话命令：claude_sessions_list / claude_active_sessions
pub mod claude;

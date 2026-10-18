//! Shell 集成：向 PTY 子进程注入 OSC 133 标记
//!
//! 终端本身只能看到一串字符流，分不清哪段是提示符、哪段是命令输出、
//! 命令是否已经结束。OSC 133（FinalTerm 约定，被 iTerm2 / Kitty / WezTerm /
//! VTE / Windows Terminal 采纳）用带外序列补上这些信息：
//!
//! - `ESC ] 133 ; D ; <exit_code> BEL` 命令结束
//! - `ESC ] 133 ; A BEL`              提示符开始
//!
//! 前端只需 `D`：它比"输出静止 N 秒"可靠得多，能准确判定一轮命令结束。
//!
//! 注入方式因 shell 而异，且都**不修改用户配置文件**，只通过启动参数加载
//! 生成的临时脚本：
//!
//! | shell      | 方式                                             |
//! |------------|--------------------------------------------------|
//! | bash       | `--rcfile`（登录模式会忽略它，因此改走非登录）    |
//! | zsh        | 临时 `ZDOTDIR`，脚本内转去加载用户的真实配置      |
//! | fish       | `-C` 初始化命令                                   |
//! | PowerShell | `-NoExit -Command ". <script>"`（profile 之后执行）|
//! | cmd        | 无钩子可用，跳过                                  |
//!
//! ConPTY 会把子进程输出的 OSC 原样透传给 xterm，Windows 下同样有效。

use std::path::PathBuf;

/// 注入结果：额外启动参数与环境变量
pub struct ShellIntegration {
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
}

/// 根据 shell 路径生成注入配置；不支持的 shell 返回 None
pub fn setup(shell_path: &str) -> Option<ShellIntegration> {
    let name = shell_name(shell_path);

    match name.as_str() {
        "bash" => setup_bash(),
        "zsh" => setup_zsh(),
        "fish" => setup_fish(),
        "powershell" | "pwsh" => setup_powershell(),
        _ => None,
    }
}

/// 从完整路径取出不带扩展名的小写程序名
fn shell_name(shell_path: &str) -> String {
    std::path::Path::new(shell_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| shell_path.to_lowercase())
}

/// 集成脚本目录（每次启动重写，避免过期）
fn script_dir() -> PathBuf {
    std::env::temp_dir().join("sterminal-shell-integration")
}

/// 写入脚本文件，返回完整路径
fn write_script(file_name: &str, content: &str) -> Option<PathBuf> {
    let dir = script_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(file_name);
    std::fs::write(&path, content).ok()?;
    Some(path)
}

/// 把路径转成 shell 单引号字符串（转义内部单引号）
///
/// 仅用于会被 shell 二次解析的场合（fish `-C`、PowerShell `-Command`）。
/// 直接作为参数传给 `--rcfile` 等时不能加引号——没有 shell 参与解析，
/// 引号会成为路径的一部分。
fn shell_quote(path: &PathBuf) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    format!("'{}'", raw.replace('\'', r"'\''"))
}

// ── bash ──

/// bash 只在**非登录**交互模式下读取 `--rcfile`（实测 5.2：`-l` 下被忽略），
/// 所以改为非登录启动，由脚本按登录顺序加载用户配置后再挂钩子。
fn setup_bash() -> Option<ShellIntegration> {
    let rc = if cfg!(windows) {
        // Windows 上原本就是非登录启动（Git Bash 非登录交互只读 ~/.bashrc）
        r#"
[ -f ~/.bashrc ] && . ~/.bashrc
"#
    } else {
        // 模拟登录 shell 的加载顺序：/etc/profile → 第一个存在的用户 profile
        // → 没有 profile 时退回 ~/.bashrc
        r#"
[ -f /etc/profile ] && . /etc/profile
if [ -f ~/.bash_profile ]; then
  . ~/.bash_profile
elif [ -f ~/.bash_login ]; then
  . ~/.bash_login
elif [ -f ~/.profile ]; then
  . ~/.profile
elif [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi
"#
    };

    let hook = r#"
# ── sTerminal OSC 133 ──
if [ -z "${__STERMINAL_133:-}" ]; then
  __STERMINAL_133=1
  __sterminal_prompt() {
    local __code=$?
    printf '\033]133;D;%s\007' "$__code"
    printf '\033]133;A\007'
  }
  # 保留用户已有的 PROMPT_COMMAND；注意它可能在上面加载的 rc 里设置
  if [ -n "${PROMPT_COMMAND:-}" ]; then
    PROMPT_COMMAND="__sterminal_prompt; ${PROMPT_COMMAND}"
  else
    PROMPT_COMMAND="__sterminal_prompt"
  fi
fi
"#;

    let path = write_script("bashrc", &format!("{}{}", rc, hook))?;
    Some(ShellIntegration {
        // 直接作为 argv 传入，不经 shell 解析，因此不加引号
        args: vec![
            "--rcfile".into(),
            path.to_string_lossy().replace('\\', "/"),
        ],
        envs: vec![],
    })
}

// ── zsh ──

/// zsh 通过 ZDOTDIR 重定向启动文件；生成的脚本再转去加载用户的真实文件，
/// 登录与交互模式都会经过这里。
fn setup_zsh() -> Option<ShellIntegration> {
    let dir = script_dir();
    std::fs::create_dir_all(&dir).ok()?;

    // 用户真实的 zsh 配置目录（未设置 ZDOTDIR 时为 $HOME）
    let user_zdotdir = std::env::var("ZDOTDIR").unwrap_or_else(|_| {
        std::env::var("HOME").unwrap_or_else(|_| "~".to_string())
    });

    // 每个文件：先加载用户的同名文件，再（仅 .zshrc）挂钩子
    let user_dir = shell_quote(&PathBuf::from(&user_zdotdir));
    let zshenv = format!(
        r#"
[ -f "{dir}/.zshenv" ] && . "{dir}/.zshenv"
export ZDOTDIR={dir_q}
"#,
        dir = user_zdotdir.replace('\'', r"'\''"),
        dir_q = user_dir
    );
    write_script(".zshenv", &zshenv)?;

    let zprofile = format!(
        r#"[ -f "{dir}/.zprofile" ] && . "{dir}/.zprofile"
"#,
        dir = user_zdotdir.replace('\'', r"'\''")
    );
    write_script(".zprofile", &zprofile)?;

    let zshrc = format!(
        r#"[ -f "{dir}/.zshrc" ] && . "{dir}/.zshrc"

# ── sTerminal OSC 133 ──
__sterminal_precmd() {{
  local __code=$?
  printf '\033]133;D;%s\007' "$__code"
  printf '\033]133;A\007'
}}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __sterminal_precmd
"#,
        dir = user_zdotdir.replace('\'', r"'\''")
    );
    write_script(".zshrc", &zshrc)?;

    Some(ShellIntegration {
        args: vec![],
        envs: vec![("ZDOTDIR".into(), dir.to_string_lossy().into_owned())],
    })
}

// ── fish ──

fn setup_fish() -> Option<ShellIntegration> {
    let script = r#"
# ── sTerminal OSC 133 ──
function __sterminal_prompt --on-event fish_postexec
    printf '\e]133;D;%s\a' $status
    printf '\e]133;A\a'
end
"#;
    let path = write_script("init.fish", script)?;
    Some(ShellIntegration {
        args: vec![
            "-C".into(),
            format!("source {}", shell_quote(&path)),
        ],
        envs: vec![],
    })
}

// ── PowerShell ──

/// `-Command` 在 profile 加载之后执行，此时覆盖 prompt 才不会被 profile 覆盖。
/// 用 `[char]27` 而非 `` `e ``，兼容 PowerShell 5.1。
fn setup_powershell() -> Option<ShellIntegration> {
    let script = r#"
# ── sTerminal OSC 133 ──
$global:__STerminalOriginalPrompt = $function:prompt
$global:__STerminalEsc = [char]27
$global:__STerminalBel = [char]7
function global:prompt {
    $ok = $?
    $code = 0
    if ($null -ne $global:LASTEXITCODE) { $code = $global:LASTEXITCODE }
    elseif (-not $ok) { $code = 1 }
    [Console]::Write("$global:__STerminalEsc]133;D;$code$global:__STerminalBel")
    [Console]::Write("$global:__STerminalEsc]133;A$global:__STerminalBel")
    & $global:__STerminalOriginalPrompt
}
"#;
    let path = write_script("init.ps1", script)?;
    let script_path = shell_quote(&path);
    Some(ShellIntegration {
        args: vec![
            "-NoLogo".into(),
            "-NoExit".into(),
            "-Command".into(),
            format!(". {}", script_path),
        ],
        envs: vec![],
    })
}

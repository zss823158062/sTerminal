//! Claude Code 会话读取命令
//!
//! 数据来源（均为 Claude Code 自己写出的文件，本模块只读不写）：
//! - `~/.claude/projects/<编码后的cwd>/<sessionId>.jsonl` —— 历史会话，一个文件一个会话
//! - `~/.claude/sessions/<pid>.json` —— 运行中会话的实时状态

use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;

/// 尾部扫描窗口。`ai-title` / `last-prompt` 由 Claude Code 在会话运行期间
/// 反复追加，总位于文件末尾附近；单个 jsonl 可达数 MB，只读末段可避免全量解析。
const TAIL_SCAN_BYTES: u64 = 256 * 1024;

/// 头部扫描行数。`cwd` / `gitBranch` / `version` 出现在首条 user 记录里，
/// 前几行通常是 mode / file-history-snapshot 等元记录，留足余量。
const HEAD_SCAN_LINES: usize = 40;

/// 单条历史会话的元信息（不含消息正文，仅供列表展示）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionMeta {
    /// 会话 UUID，即 jsonl 文件名，可直接传给 `claude --resume`
    pub session_id: String,
    /// 显示标题：Claude Code 生成的 aiTitle 优先，回退到最后一条用户输入
    pub title: String,
    /// 最后一条用户输入，作副标题
    pub last_prompt: String,
    /// jsonl 内记录的真实工作目录（含中文），用于精确校验与展示
    pub cwd: String,
    /// 会话开始时所在的 git 分支
    pub git_branch: String,
    /// 首条记录时间，ISO 8601
    pub started_at: String,
    /// 文件 mtime 毫秒时间戳，作为最后活动时间
    pub updated_at: i64,
    /// jsonl 文件字节数，粗略指示会话规模
    pub size_bytes: u64,
}

/// 运行中的 Claude 进程状态
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveClaudeSession {
    pub session_id: String,
    pub pid: u32,
    pub cwd: String,
    /// `idle` | `busy` | `waiting`
    pub status: String,
    /// status 为 waiting 时的等待原因，如 `permission prompt`
    pub waiting_for: String,
    /// Claude Code 派生的会话名，如 `sterminal-2b`
    pub name: String,
    pub updated_at: i64,
}

/// 把绝对路径编码为 Claude Code 的项目目录名。
///
/// 规则（实测反推并交叉验证）：逐字符扫描，非 `[A-Za-z0-9]` 的字符各替换成一个 `-`。
/// ```text
/// E:\senx\2026项目\sTerminal   →  E--senx-2026---sTerminal
/// E:\忻道\忻道小程序\drxin-code  →  E-----------drxin-code
/// ```
/// 中文被压成等长的 `-`，因此该编码不可逆；但正向可算，本模块只需正向。
fn encode_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// 归一化路径用于比较：统一分隔符，Windows 下同时忽略大小写
fn normalize_path(path: &str) -> String {
    let unified = path.replace('/', "\\");
    let trimmed = unified.trim_end_matches('\\');
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_string()
    }
}

/// 定位 cwd 对应的项目目录。
///
/// 精确命中优先；未命中时退化为大小写不敏感匹配——实测 Claude Code 保留原始
/// 盘符大小写，同一物理路径可能同时存在 `E--...` 与 `e--...` 两个目录。
fn find_project_dir(projects_root: &Path, encoded: &str) -> Option<PathBuf> {
    let exact = projects_root.join(encoded);
    if exact.is_dir() {
        return Some(exact);
    }
    for entry in fs::read_dir(projects_root).ok()?.flatten() {
        if entry.file_name().to_string_lossy().eq_ignore_ascii_case(encoded)
            && entry.path().is_dir()
        {
            return Some(entry.path());
        }
    }
    None
}

/// 取文件 mtime 的毫秒时间戳，失败返回 0
fn mtime_millis(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 从 jsonl 头部提取的会话上下文
#[derive(Default)]
struct HeadMeta {
    cwd: String,
    git_branch: String,
    started_at: String,
}

/// 读取 jsonl 头部若干行，取首条带 `cwd` 的记录里的会话上下文。
///
/// 前几行通常是 `mode` / `file-history-snapshot` 等元记录，不含 cwd。
fn read_head_meta(path: &Path) -> HeadMeta {
    let mut meta = HeadMeta::default();
    let Ok(file) = fs::File::open(path) else {
        return meta;
    };
    for line in BufReader::new(file).lines().take(HEAD_SCAN_LINES) {
        let Ok(line) = line else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(cwd) = value.get("cwd").and_then(|v| v.as_str()) else {
            continue;
        };
        meta.cwd = cwd.to_string();
        meta.git_branch = value
            .get("gitBranch")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        meta.started_at = value
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        break;
    }
    meta
}

/// 从 jsonl 尾部提取的标题信息
#[derive(Default)]
struct TailMeta {
    ai_title: String,
    last_prompt: String,
}

/// 反向扫描 jsonl 末段，取最后写入的 `ai-title` 与 `last-prompt`。
///
/// 两类记录都会在会话运行期间反复追加，反向遇到的第一条即最新值。
/// 从窗口中间 seek 可能切断多字节字符，首行残片会解析失败并被跳过，无需特殊处理。
fn read_tail_meta(path: &Path, size: u64) -> TailMeta {
    let mut meta = TailMeta::default();
    let Ok(mut file) = fs::File::open(path) else {
        return meta;
    };
    let start = size.saturating_sub(TAIL_SCAN_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return meta;
    }
    let mut buf = Vec::new();
    if file.read_to_end(&mut buf).is_err() {
        return meta;
    }
    let text = String::from_utf8_lossy(&buf);

    for line in text.lines().rev() {
        if !meta.ai_title.is_empty() && !meta.last_prompt.is_empty() {
            break;
        }
        // 先做子串预筛，避免对每一行都做 JSON 解析
        let has_title = meta.ai_title.is_empty() && line.contains("\"ai-title\"");
        let has_prompt = meta.last_prompt.is_empty() && line.contains("\"last-prompt\"");
        if !has_title && !has_prompt {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        match value.get("type").and_then(|v| v.as_str()) {
            Some("ai-title") if has_title => {
                if let Some(t) = value.get("aiTitle").and_then(|v| v.as_str()) {
                    meta.ai_title = t.to_string();
                }
            }
            Some("last-prompt") if has_prompt => {
                if let Some(p) = value.get("lastPrompt").and_then(|v| v.as_str()) {
                    meta.last_prompt = p.to_string();
                }
            }
            _ => {}
        }
    }
    meta
}

/// 按字符数截断，保证 UTF-8 边界安全
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect::<String>() + "…"
}

/// 列出指定工作目录下的 Claude Code 历史会话，按最后活动时间降序。
///
/// 目录不存在（该 cwd 从未跑过 Claude）时返回空列表而非错误。
#[tauri::command]
pub async fn claude_sessions_list(cwd: String) -> Result<Vec<ClaudeSessionMeta>, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let projects_root = home.join(".claude").join("projects");
    let Some(dir) = find_project_dir(&projects_root, &encode_project_dir(&cwd)) else {
        return Ok(Vec::new());
    };

    let target = normalize_path(&cwd);
    let mut sessions = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let size = meta.len();
        if size == 0 {
            continue;
        }
        let Some(session_id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };

        let head = read_head_meta(&path);
        // 编码不可逆会引入碰撞（如 a_b 与 a-b 映射到同一目录名），
        // 用 jsonl 内记录的真实 cwd 做精确过滤
        if !head.cwd.is_empty() && normalize_path(&head.cwd) != target {
            continue;
        }

        let tail = read_tail_meta(&path, size);
        // Claude Code 自己生成的 aiTitle 最可读；没有时退化为最后一条用户输入
        let title = if tail.ai_title.is_empty() {
            truncate_chars(&tail.last_prompt, 60)
        } else {
            tail.ai_title.clone()
        };

        sessions.push(ClaudeSessionMeta {
            session_id: session_id.to_string(),
            title,
            last_prompt: truncate_chars(&tail.last_prompt, 300),
            cwd: head.cwd,
            git_branch: head.git_branch,
            started_at: head.started_at,
            updated_at: mtime_millis(&meta),
            size_bytes: size,
        });
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

/// 列出所有运行中的 Claude 进程状态，按最后更新时间降序。
///
/// 不做进程存活校验：Claude Code 异常退出会残留 json，调用方按 sessionId 匹配
/// 历史列表来打标记，残留文件最坏只会给已结束的会话多一个标记，无副作用。
#[tauri::command]
pub async fn claude_active_sessions() -> Result<Vec<ActiveClaudeSession>, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let sessions_root = home.join(".claude").join("sessions");
    if !sessions_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut active = Vec::new();

    for entry in fs::read_dir(&sessions_root).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        // 同目录下还有 <pid>.<hash>.key 文件，只取 .json
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let Some(session_id) = value.get("sessionId").and_then(|v| v.as_str()) else {
            continue;
        };

        let str_field = |key: &str| {
            value
                .get(key)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string()
        };

        active.push(ActiveClaudeSession {
            session_id: session_id.to_string(),
            pid: value.get("pid").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
            cwd: str_field("cwd"),
            status: str_field("status"),
            waiting_for: str_field("waitingFor"),
            name: str_field("name"),
            updated_at: value.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(0),
        });
    }

    active.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(active)
}

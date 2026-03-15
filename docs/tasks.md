# sTerminal - 任务分配文档

## 1. 团队配置

| 角色 | 编号 | 模型 | 职责范围 |
|------|------|------|---------|
| 架构师 / 全栈 | DEV-A | claude-sonnet-4-6 | 项目骨架初始化、Tauri 配置、共享类型定义、PTY 核心命令（terminal_create / terminal_kill / terminal_resize）、tauri-plugin-store 持久化层 |
| Rust 后端开发 | DEV-B | claude-sonnet-4-6 | PTY 进程管理（write / read 事件推送）、Shell 检测、进程泄漏防护、窗口关闭清理、Rust 错误处理 |
| 前端开发 A | DEV-C | claude-sonnet-4-6 | 布局引擎（二叉树递归渲染、分割线拖拽、rAF 节流）、Zustand 布局状态管理、面板分割 / 关闭交互 |
| 前端开发 B | DEV-D | claude-sonnet-4-6 | xterm.js 集成、终端面板 UI 组件、布局保存 / 加载 / 管理浮层、窗口复制功能、快捷键绑定 |

---

## 2. 系统架构

### 2.1 目录结构

```
sTerminal/
├── src-tauri/                          # Rust 后端（DEV-A / DEV-B）
│   ├── Cargo.toml                      # Rust 依赖配置
│   ├── build.rs                        # Tauri 构建脚本
│   ├── tauri.conf.json                 # Tauri 应用配置
│   ├── capabilities/
│   │   └── default.json                # Tauri v2 权限声明
│   └── src/
│       ├── main.rs                     # 应用入口，注册 commands，on_window_close
│       ├── lib.rs                      # Tauri Builder 配置，插件注册
│       ├── commands/
│       │   ├── mod.rs                  # commands 模块聚合
│       │   ├── terminal.rs             # PTY 命令：create/write/resize/kill/get_cwd（DEV-A + DEV-B）
│       │   └── layout.rs               # 布局命令：save/load/list/delete/rename（DEV-A）
│       ├── pty/
│       │   ├── mod.rs                  # PTY 模块聚合
│       │   ├── manager.rs              # PtyManager：进程注册表、生命周期管理（DEV-B）
│       │   └── process.rs              # PtyProcess：单个 PTY 进程封装（DEV-B）
│       ├── shell/
│       │   ├── mod.rs                  # shell 模块聚合
│       │   └── detector.rs             # Shell 可执行路径检测（DEV-B）
│       └── store/
│           ├── mod.rs                  # store 模块聚合
│           └── layout_store.rs         # tauri-plugin-store 读写封装（DEV-A）
│
├── src/                                # React 前端
│   ├── main.tsx                        # React 入口，挂载 App
│   ├── App.tsx                         # 根组件，全局快捷键注册（DEV-D）
│   ├── types/
│   │   ├── layout.ts                   # LayoutNode / SavedLayout / AppStore 类型（DEV-A 创建）
│   │   └── terminal.ts                 # PanelState / ShellType / TerminalEvent 类型（DEV-A 创建）
│   ├── store/
│   │   ├── layoutStore.ts              # Zustand：布局树状态（DEV-C）
│   │   └── panelStore.ts               # Zustand：运行时面板状态（DEV-C）
│   ├── ipc/
│   │   ├── terminalApi.ts              # invoke 封装：terminal_* 命令（DEV-A 创建骨架，DEV-D 使用）
│   │   └── layoutApi.ts                # invoke 封装：layout_* 命令（DEV-A 创建骨架，DEV-D 使用）
│   ├── components/
│   │   ├── layout/
│   │   │   ├── LayoutRenderer.tsx      # 递归渲染 LayoutNode 树（DEV-C）
│   │   │   ├── SplitPane.tsx           # 分割节点：渲染两个子面板 + 分割线（DEV-C）
│   │   │   ├── SplitHandle.tsx         # 可拖拽分割线组件，rAF 节流（DEV-C）
│   │   │   └── PanelContainer.tsx      # 叶子面板容器，管理面板头部 + xterm 实例（DEV-C / DEV-D 协作）
│   │   ├── terminal/
│   │   │   ├── TerminalPane.tsx        # xterm.js 实例封装，生命周期管理（DEV-D）
│   │   │   ├── TerminalHeader.tsx      # 面板头部：Shell 图标、目录名、操作按钮（DEV-D）
│   │   │   └── TerminalContextMenu.tsx # 右键菜单：分割 / 复制 / 关闭（DEV-D）
│   │   ├── titlebar/
│   │   │   └── TitleBar.tsx            # 自定义无边框标题栏，布局菜单入口（DEV-D）
│   │   └── layout-manager/
│   │       ├── LayoutManagerDrawer.tsx # 布局管理侧边抽屉（DEV-D）
│   │       ├── LayoutListItem.tsx      # 布局列表单条记录（DEV-D）
│   │       └── SaveLayoutDialog.tsx    # 保存布局弹窗（DEV-D）
│   ├── hooks/
│   │   ├── useTerminal.ts              # xterm.js 初始化 + PTY 事件订阅（DEV-D）
│   │   ├── useResize.ts                # 分割线拖拽逻辑（rAF 节流）（DEV-C）
│   │   └── useKeyboardShortcuts.ts     # 全局快捷键绑定（DEV-D）
│   ├── utils/
│   │   ├── layoutTree.ts               # 布局树操作：insert / remove / update 纯函数（DEV-C）
│   │   └── shellIcons.ts               # Shell 类型 → 图标映射（DEV-D）
│   └── styles/
│       ├── global.css                  # 全局深色主题变量、reset（DEV-A 创建）
│       └── terminal.css                # xterm.js 容器样式（DEV-D）
│
├── index.html                          # HTML 入口
├── vite.config.ts                      # Vite 配置
├── tsconfig.json                       # TypeScript 配置
├── package.json                        # 前端依赖
└── docs/
    ├── prd.md
    └── tasks.md
```

### 2.2 模块划分

| 模块 | 路径 | 职责 | 边界 |
|------|------|------|------|
| PTY 核心层 | `src-tauri/src/pty/` | 创建、读写、resize、kill PTY 进程；维护进程注册表 | 只负责进程生命周期，不涉及序列化 |
| Shell 检测层 | `src-tauri/src/shell/` | 按平台探测可用 Shell 可执行路径 | 纯探测，无副作用 |
| Tauri Commands 层 | `src-tauri/src/commands/` | 将 PTY 操作和持久化操作暴露为 `#[tauri::command]`，是前后端通信唯一入口 | 只做参数转发和错误映射，业务逻辑在 pty/ 和 store/ |
| 持久化层 | `src-tauri/src/store/` | 通过 tauri-plugin-store 读写 `config.json`，提供类型安全的 SavedLayout CRUD | 只操作磁盘，不管理运行时状态 |
| IPC 封装层 | `src/ipc/` | TypeScript 对 Tauri invoke 的类型安全封装，所有前端对后端的调用必须经过此层 | 不包含业务逻辑，只做调用封装 |
| 状态管理层 | `src/store/` | Zustand store：布局树状态 + 运行时面板状态。是前端状态的唯一可信来源 | 不直接调用 IPC，由组件/hooks 触发 |
| 布局引擎层 | `src/components/layout/` | 递归渲染 LayoutNode 二叉树，处理分割线拖拽和比例更新 | 只负责布局结构渲染，不持有 xterm.js 实例 |
| 终端组件层 | `src/components/terminal/` | xterm.js 生命周期管理、PTY 输入输出桥接、面板头部 UI | 只负责单个终端面板的渲染和交互 |
| 布局管理 UI | `src/components/layout-manager/` | 布局列表展示、保存/加载/删除/重命名交互 | 只调用 layoutApi，不直接操作 Zustand |

---

## 3. API 契约

### 3.1 Tauri Commands（前端 invoke → Rust 后端执行）

#### terminal_create

```rust
/// 创建一个新的 PTY 进程，返回分配的终端 ID
///
/// # 参数
/// - `shell_path`: Shell 可执行文件的完整路径（如 "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"）
/// - `working_directory`: 初始工作目录的绝对路径；若目录不存在则回退到用户 Home 目录
/// - `cols`: 终端列数，最小 10，最大 512
/// - `rows`: 终端行数，最小 5，最大 256
///
/// # 返回
/// - `Ok(String)`: 新建终端的唯一 ID（UUID v4 格式）
/// - `Err(String)`: 错误原因描述（如 shell 不存在、PTY 创建失败）
#[tauri::command]
async fn terminal_create(
    shell_path: String,
    working_directory: String,
    cols: u16,
    rows: u16,
    app: AppHandle,
) -> Result<String, String>
```

#### terminal_write

```rust
/// 向指定终端的 PTY 进程写入数据（用户键盘输入）
///
/// # 参数
/// - `terminal_id`: 目标终端 ID，必须是 terminal_create 返回的有效 ID
/// - `data`: 要写入的字节序列（键盘输入、控制字符等）
///
/// # 返回
/// - `Ok(())`: 写入成功
/// - `Err(String)`: 终端 ID 不存在或进程已退出
#[tauri::command]
async fn terminal_write(
    terminal_id: String,
    data: Vec<u8>,
    state: State<'_, PtyManager>,
) -> Result<(), String>
```

#### terminal_resize

```rust
/// 调整指定终端的 PTY 窗口大小，同步发送 SIGWINCH 信号
///
/// # 参数
/// - `terminal_id`: 目标终端 ID
/// - `cols`: 新的列数，范围 [10, 512]
/// - `rows`: 新的行数，范围 [5, 256]
///
/// # 返回
/// - `Ok(())`: resize 成功
/// - `Err(String)`: 终端 ID 不存在或 resize 系统调用失败
#[tauri::command]
async fn terminal_resize(
    terminal_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyManager>,
) -> Result<(), String>
```

#### terminal_kill

```rust
/// 终止指定终端的 PTY 进程并从注册表中移除
///
/// # 参数
/// - `terminal_id`: 要终止的终端 ID
///
/// # 返回
/// - `Ok(())`: 进程已终止（幂等：若进程已不存在也返回 Ok）
/// - `Err(String)`: 终止失败（系统权限不足等）
#[tauri::command]
async fn terminal_kill(
    terminal_id: String,
    state: State<'_, PtyManager>,
) -> Result<(), String>
```

#### terminal_get_cwd

```rust
/// 获取指定终端进程的当前工作目录
///
/// # 参数
/// - `terminal_id`: 目标终端 ID
///
/// # 返回
/// - `Ok(String)`: 当前工作目录绝对路径
/// - `Err(String)`: 无法获取（进程已退出、平台不支持等），调用方应使用面板记录的初始目录作为回退
#[tauri::command]
async fn terminal_get_cwd(
    terminal_id: String,
    state: State<'_, PtyManager>,
) -> Result<String, String>
```

#### shell_list_available

```rust
/// 列出当前系统上可用的 Shell 可执行路径列表
///
/// # 返回
/// - `Ok(Vec<ShellInfo>)`: 可用 Shell 列表（至少包含系统默认 Shell）
/// - `Err(String)`: 探测失败（极少见）
#[tauri::command]
async fn shell_list_available() -> Result<Vec<ShellInfo>, String>
```

#### layout_save

```rust
/// 保存当前布局为命名布局记录
///
/// # 参数
/// - `name`: 布局名称，1-50 个字符，不允许为空
/// - `tree`: 序列化的布局树 JSON 字符串（对应 LayoutNode 结构）
///
/// # 返回
/// - `Ok(String)`: 新建布局的 UUID
/// - `Err(String)`: 名称为空、超过 50 个布局上限、序列化失败等
#[tauri::command]
async fn layout_save(
    name: String,
    tree: serde_json::Value,
    app: AppHandle,
) -> Result<String, String>
```

#### layout_list

```rust
/// 获取所有已保存的布局列表
///
/// # 返回
/// - `Ok(Vec<SavedLayoutMeta>)`: 按 updatedAt 降序排列的布局元数据列表（不含完整树结构，减少传输量）
/// - `Err(String)`: 存储读取失败
#[tauri::command]
async fn layout_list(app: AppHandle) -> Result<Vec<SavedLayoutMeta>, String>
```

#### layout_load

```rust
/// 加载指定 ID 的完整布局数据
///
/// # 参数
/// - `layout_id`: 要加载的布局 UUID
///
/// # 返回
/// - `Ok(SavedLayout)`: 完整布局记录（含树结构）
/// - `Err(String)`: ID 不存在或存储读取失败
#[tauri::command]
async fn layout_load(
    layout_id: String,
    app: AppHandle,
) -> Result<SavedLayout, String>
```

#### layout_delete

```rust
/// 删除指定 ID 的布局记录
///
/// # 参数
/// - `layout_id`: 要删除的布局 UUID
///
/// # 返回
/// - `Ok(())`: 删除成功（幂等：ID 不存在也返回 Ok）
/// - `Err(String)`: 存储写入失败
#[tauri::command]
async fn layout_delete(
    layout_id: String,
    app: AppHandle,
) -> Result<(), String>
```

#### layout_rename

```rust
/// 重命名指定 ID 的布局
///
/// # 参数
/// - `layout_id`: 要重命名的布局 UUID
/// - `new_name`: 新名称，1-50 个字符
///
/// # 返回
/// - `Ok(())`: 重命名成功
/// - `Err(String)`: ID 不存在、名称不合法或存储写入失败
#[tauri::command]
async fn layout_rename(
    layout_id: String,
    new_name: String,
    app: AppHandle,
) -> Result<(), String>
```

#### settings_get

```rust
/// 读取应用设置
///
/// # 返回
/// - `Ok(AppSettings)`: 当前应用设置
/// - `Err(String)`: 读取失败（回退到默认值）
#[tauri::command]
async fn settings_get(app: AppHandle) -> Result<AppSettings, String>
```

#### settings_save

```rust
/// 持久化保存应用设置
///
/// # 参数
/// - `settings`: 要保存的设置对象
///
/// # 返回
/// - `Ok(())`: 保存成功
/// - `Err(String)`: 写入失败
#[tauri::command]
async fn settings_save(
    settings: AppSettings,
    app: AppHandle,
) -> Result<(), String>
```

---

### 3.2 前端 → 后端调用（TypeScript invoke 封装）

```typescript
// src/ipc/terminalApi.ts

/** 创建 PTY 进程，返回 terminalId */
function terminalCreate(params: {
  shellPath: string;      // Shell 可执行文件完整路径
  workingDirectory: string; // 初始工作目录绝对路径
  cols: number;           // 列数，范围 [10, 512]
  rows: number;           // 行数，范围 [5, 256]
}): Promise<string>

/** 向 PTY 写入键盘输入 */
function terminalWrite(params: {
  terminalId: string;     // 目标终端 ID
  data: Uint8Array;       // 要写入的字节数据
}): Promise<void>

/** 调整 PTY 窗口大小 */
function terminalResize(params: {
  terminalId: string;     // 目标终端 ID
  cols: number;           // 新列数
  rows: number;           // 新行数
}): Promise<void>

/** 终止 PTY 进程 */
function terminalKill(params: {
  terminalId: string;     // 要终止的终端 ID
}): Promise<void>

/** 获取终端当前工作目录 */
function terminalGetCwd(params: {
  terminalId: string;     // 目标终端 ID
}): Promise<string>

/** 获取系统可用 Shell 列表 */
function shellListAvailable(): Promise<ShellInfo[]>
```

```typescript
// src/ipc/layoutApi.ts

/** 保存布局 */
function layoutSave(params: {
  name: string;           // 布局名称，1-50 字符
  tree: LayoutNode;       // 完整布局树
}): Promise<string>       // 返回新建布局 UUID

/** 获取布局列表（不含树结构） */
function layoutList(): Promise<SavedLayoutMeta[]>

/** 加载布局完整数据 */
function layoutLoad(params: {
  layoutId: string;       // 布局 UUID
}): Promise<SavedLayout>

/** 删除布局 */
function layoutDelete(params: {
  layoutId: string;       // 布局 UUID
}): Promise<void>

/** 重命名布局 */
function layoutRename(params: {
  layoutId: string;       // 布局 UUID
  newName: string;        // 新名称，1-50 字符
}): Promise<void>

/** 读取应用设置 */
function settingsGet(): Promise<AppSettings>

/** 保存应用设置 */
function settingsSave(params: AppSettings): Promise<void>
```

---

### 3.3 后端 → 前端事件（Rust emit → TypeScript listen）

#### terminal:output

```
事件名：terminal:output
触发方：Rust PTY 读取线程，每当 PTY 输出新数据时触发
接收方：前端 useTerminal hook，写入对应 xterm.js 实例

Payload 类型（TypeScript）：
interface TerminalOutputEvent {
  terminalId: string;   // 产生输出的终端 ID
  data: number[];       // PTY 输出的原始字节数组（JSON 序列化限制，使用 number[] 代替 Uint8Array）
}
```

#### terminal:exit

```
事件名：terminal:exit
触发方：Rust PTY 读取线程，当 PTY 进程退出时触发
接收方：前端 useTerminal hook / panelStore，更新 isAlive 状态

Payload 类型（TypeScript）：
interface TerminalExitEvent {
  terminalId: string;   // 退出的终端 ID
  exitCode: number;     // 进程退出码，正常退出为 0，异常退出为非 0
}
```

---

## 4. 共享类型定义

### 4.1 TypeScript 类型（前端）

```typescript
// src/types/layout.ts

/**
 * 叶子节点：代表一个真实的终端面板
 */
interface TerminalLeaf {
  /** 节点类型标识符，固定为 'terminal' */
  type: 'terminal';
  /** 面板唯一 ID，UUID v4 格式，在整个应用生命周期内不重复 */
  id: string;
  /** Shell 类型标识符，如 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' */
  shellType: string;
  /** Shell 可执行文件完整路径，如 '/bin/bash' 或 'C:/Windows/System32/cmd.exe' */
  shellPath: string;
  /** 初始工作目录的绝对路径；加载布局时若目录不存在则回退到 Home 目录 */
  workingDirectory: string;
}

/**
 * 分割节点：包含两个子面板和分割方向
 */
interface SplitNode {
  /** 节点类型标识符，固定为 'split' */
  type: 'split';
  /**
   * 分割方向
   * - 'horizontal'：左右分割（first 在左，second 在右）
   * - 'vertical'：上下分割（first 在上，second 在下）
   */
  direction: 'horizontal' | 'vertical';
  /**
   * first 子节点占父容器的比例，范围 [0.1, 0.9]
   * second 子节点占比 = 1 - ratio
   */
  ratio: number;
  /** 第一个子节点（左侧或上方） */
  first: LayoutNode;
  /** 第二个子节点（右侧或下方） */
  second: LayoutNode;
}

/** 布局节点联合类型 */
type LayoutNode = TerminalLeaf | SplitNode;

/**
 * 已保存的布局完整记录
 */
interface SavedLayout {
  /** 布局唯一 ID，UUID v4 格式 */
  id: string;
  /** 用户命名的布局名称，1-50 字符 */
  name: string;
  /** 布局创建时间，ISO 8601 格式，如 '2026-03-15T10:00:00.000Z' */
  createdAt: string;
  /** 布局最后更新时间，ISO 8601 格式 */
  updatedAt: string;
  /** 完整的布局树结构 */
  tree: LayoutNode;
}

/**
 * 布局列表元数据（不含树结构，用于列表展示，减少传输量）
 */
interface SavedLayoutMeta {
  /** 布局唯一 ID */
  id: string;
  /** 布局名称 */
  name: string;
  /** 创建时间，ISO 8601 格式 */
  createdAt: string;
  /** 更新时间，ISO 8601 格式 */
  updatedAt: string;
  /** 该布局包含的叶子节点（终端面板）数量 */
  panelCount: number;
}

/**
 * 持久化存储的完整数据结构（tauri-plugin-store 存储在 config.json）
 */
interface AppStore {
  /** 已保存的布局列表，最多 50 条 */
  layouts: SavedLayout[];
  /**
   * 应用退出前的布局快照，用于下次启动时自动恢复
   * undefined 表示不需要自动恢复
   */
  lastLayout?: LayoutNode;
  /** 应用全局设置 */
  settings: AppSettings;
}

/**
 * 应用全局设置
 */
interface AppSettings {
  /** 默认 Shell 类型标识符，如 'powershell' | 'bash' */
  defaultShell: string;
  /** 默认初始工作目录绝对路径，空字符串表示使用用户 Home 目录 */
  defaultWorkingDirectory: string;
}
```

```typescript
// src/types/terminal.ts

/**
 * 运行时面板状态（仅存在于内存，不持久化）
 */
interface PanelState {
  /** 面板唯一 ID，与 TerminalLeaf.id 保持一致 */
  id: string;
  /**
   * 由 Rust 后端 terminal_create 返回的终端 ID
   * 与面板 ID 一一对应，用于 invoke 调用时索引 PTY 进程
   */
  terminalId: string;
  /** PTY 子进程的操作系统 PID，用于调试和显示 */
  pid: number;
  /**
   * 终端实时工作目录
   * 通过 terminal_get_cwd 查询更新，初始值为 TerminalLeaf.workingDirectory
   */
  currentWorkingDirectory: string;
  /** PTY 进程是否存活；false 时显示"进程已退出"提示 */
  isAlive: boolean;
  /** 进程退出码；isAlive 为 false 时有效；0 表示正常退出 */
  exitCode?: number;
}

/**
 * Shell 类型信息（由后端 shell_list_available 返回）
 */
interface ShellInfo {
  /** Shell 类型标识符，小写无空格，如 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'git-bash' */
  type: string;
  /** Shell 可显示名称，如 'PowerShell 7' | 'Command Prompt' */
  displayName: string;
  /** Shell 可执行文件完整绝对路径 */
  path: string;
  /** 是否为系统默认 Shell */
  isDefault: boolean;
}

/**
 * terminal:output 事件 Payload
 */
interface TerminalOutputEvent {
  /** 产生输出的终端 ID（对应 PanelState.terminalId） */
  terminalId: string;
  /** PTY 输出的原始字节（JSON 序列化为 number 数组） */
  data: number[];
}

/**
 * terminal:exit 事件 Payload
 */
interface TerminalExitEvent {
  /** 退出的终端 ID */
  terminalId: string;
  /** 进程退出码；0 表示正常退出 */
  exitCode: number;
}
```

---

### 4.2 Rust 类型（后端）

```rust
// src-tauri/src/commands/terminal.rs（部分）和 src-tauri/src/pty/manager.rs

use serde::{Deserialize, Serialize};

/// Shell 信息，对应前端 ShellInfo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellInfo {
    /// Shell 类型标识符，小写，如 "powershell" | "cmd" | "bash" | "zsh"
    #[serde(rename = "type")]
    pub shell_type: String,
    /// 用户可见的显示名称，如 "PowerShell 7"
    pub display_name: String,
    /// Shell 可执行文件完整绝对路径
    pub path: String,
    /// 是否为系统默认 Shell
    pub is_default: bool,
}

/// terminal:output 事件 Payload，对应前端 TerminalOutputEvent
#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutputEvent {
    /// 产生输出的终端 ID
    pub terminal_id: String,
    /// PTY 输出字节数组
    pub data: Vec<u8>,
}

/// terminal:exit 事件 Payload，对应前端 TerminalExitEvent
#[derive(Debug, Clone, Serialize)]
pub struct TerminalExitEvent {
    /// 退出的终端 ID
    pub terminal_id: String,
    /// 进程退出码
    pub exit_code: i32,
}
```

```rust
// src-tauri/src/store/layout_store.rs

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 布局节点联合类型（通过 type 字段区分），对应前端 LayoutNode
/// 使用 serde_json::Value 存储 tree，避免在 Rust 侧重复定义递归类型
/// 验证逻辑在前端 TypeScript 侧完成

/// 完整布局记录，对应前端 SavedLayout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedLayout {
    /// 布局唯一 ID，UUID v4
    pub id: String,
    /// 用户命名的布局名称，1-50 字符
    pub name: String,
    /// 创建时间，ISO 8601 格式字符串
    pub created_at: String,
    /// 最后更新时间，ISO 8601 格式字符串
    pub updated_at: String,
    /// 布局树的 JSON 值（对应前端 LayoutNode）
    pub tree: Value,
}

/// 布局列表元数据（不含树结构），对应前端 SavedLayoutMeta
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedLayoutMeta {
    /// 布局唯一 ID
    pub id: String,
    /// 布局名称
    pub name: String,
    /// 创建时间，ISO 8601 格式
    pub created_at: String,
    /// 更新时间，ISO 8601 格式
    pub updated_at: String,
    /// 布局包含的终端面板数量
    pub panel_count: u32,
}

/// 应用设置，对应前端 AppSettings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// 默认 Shell 类型标识符
    pub default_shell: String,
    /// 默认初始工作目录，空字符串使用 Home 目录
    pub default_working_directory: String,
}
```

---

## 5. 命名规范表

| 概念 | 前端 (TypeScript) | 后端 (Rust) | 说明 |
|------|-------------------|-------------|------|
| 终端 ID | `terminalId: string` | `terminal_id: String` | PTY 进程的唯一标识，UUID v4，由后端 terminal_create 生成并返回给前端 |
| 面板 ID | `panelId: string` (也作 `id` in TerminalLeaf) | 无后端对应（纯前端概念） | 布局树叶子节点的唯一 ID，用于前端区分面板；与 terminalId 不同，面板 ID 在序列化到 SavedLayout 时持久化 |
| 布局树 | `LayoutNode` (type union) | `serde_json::Value` (存储) | 布局的递归二叉树数据结构；前端有完整类型定义，后端存储为不透明 JSON |
| 叶子节点 | `TerminalLeaf` | 无独立类型（含在 Value 内） | 布局树的叶子，代表一个真实终端 |
| 分割节点 | `SplitNode` | 无独立类型（含在 Value 内） | 布局树的内部节点，含分割方向和比例 |
| 分割方向（水平） | `'horizontal'` | `"horizontal"` | 左右分割，两个子面板并排 |
| 分割方向（垂直） | `'vertical'` | `"vertical"` | 上下分割，两个子面板堆叠 |
| 比例 | `ratio: number` | `ratio: f64`（含在 tree Value 内） | first 子节点占父容器的比例，范围 [0.1, 0.9] |
| Shell 类型 | `shellType: string` / `ShellInfo.type` | `shell_type: String` | Shell 的字符串标识，小写，如 "powershell"、"bash"、"cmd" |
| Shell 路径 | `shellPath: string` / `ShellInfo.path` | `path: String` | Shell 可执行文件的绝对路径 |
| 工作目录 | `workingDirectory: string` | `working_directory: String` | 终端启动时的初始工作目录绝对路径 |
| 当前工作目录 | `currentWorkingDirectory: string` | `current_working_directory: String` | 终端运行时实时工作目录（通过 terminal_get_cwd 获取） |
| 已保存布局 | `SavedLayout` | `SavedLayout` | 一条完整的布局持久化记录 |
| 布局元数据 | `SavedLayoutMeta` | `SavedLayoutMeta` | 布局的摘要信息，不含树结构 |
| 创建时间 | `createdAt: string` | `created_at: String` | ISO 8601 时间戳字符串 |
| 更新时间 | `updatedAt: string` | `updated_at: String` | ISO 8601 时间戳字符串 |
| 面板存活状态 | `isAlive: boolean` | `is_alive: bool`（含在 PtyProcess 内） | PTY 进程是否仍在运行 |
| 退出码 | `exitCode: number` | `exit_code: i32` | 进程退出状态码 |
| PTY 输出事件 | `'terminal:output'` | `"terminal:output"` | Tauri 事件名，后端 emit，前端 listen |
| PTY 退出事件 | `'terminal:exit'` | `"terminal:exit"` | Tauri 事件名，后端 emit，前端 listen |
| 应用设置 | `AppSettings` | `AppSettings` | 全局配置，存储在 config.json 的 settings 字段 |

---

## 6. 数据流图

### 6.1 终端创建流程

```
用户操作（点击分割 / 启动）
    │
    ▼
[前端] layoutStore.splitPanel(panelId, direction)
    │  生成新 TerminalLeaf { id: newPanelId, shellType, shellPath, workingDirectory }
    │  更新布局树状态，触发 LayoutRenderer 重渲染
    │
    ▼
[前端] TerminalPane.tsx 挂载（新叶子节点渲染）
    │  调用 useTerminal(panelId, shellPath, workingDirectory, cols, rows)
    │
    ▼
[前端] terminalApi.terminalCreate({ shellPath, workingDirectory, cols, rows })
    │  Tauri invoke('terminal_create', { shell_path, working_directory, cols, rows })
    │
    ▼
[后端] terminal_create command
    │  PtyManager.create(shell_path, working_directory, cols, rows)
    │  → portable_pty::new_pty(PtySize { rows, cols })
    │  → pty.spawn(Command::new(shell_path).current_dir(working_directory))
    │  → 注册 PtyProcess { terminal_id, master, pid }
    │  → 启动后台读取线程：loop { read(master) → emit('terminal:output', { terminal_id, data }) }
    │
    ▼
[后端] return Ok(terminal_id)  ──────────────────────────────────────────────────┐
    │                                                                              │
    ▼                                                                              │
[前端] terminalApi 返回 terminalId                                                │
    │  panelStore.addPanel({ id: panelId, terminalId, pid, cwd, isAlive: true }) │
    │  xterm.js Terminal 实例创建，attach 到 DOM                                 │
    │                                                                              │
    ▼                                                                              │
[前端] listen('terminal:output', handler)  ←── 后台读取线程持续 emit ────────────┘
    │  handler: 过滤 terminalId → xterm.write(Uint8Array(data))
```

### 6.2 终端输入/输出流程

```
用户键盘输入
    │
    ▼
[前端] xterm.js onData 回调触发
    │  data: string（xterm 编码后的字符序列）
    │
    ▼
[前端] terminalApi.terminalWrite({ terminalId, data: new TextEncoder().encode(data) })
    │  Tauri invoke('terminal_write', { terminal_id, data: Array.from(bytes) })
    │
    ▼
[后端] terminal_write command
    │  PtyManager.write(terminal_id, data)
    │  → master.write_all(&data)
    │
    ▼
[后端] PTY 进程处理输入，产生输出
    │
    ▼
[后端] 后台读取线程读取 master 输出
    │  app_handle.emit('terminal:output', TerminalOutputEvent { terminal_id, data })
    │
    ▼
[前端] listen('terminal:output') handler
    │  过滤 terminalId 匹配
    │  xterm.write(new Uint8Array(data))
    │
    ▼
用户看到终端输出渲染
```

### 6.3 布局保存/加载流程

```
【保存流程】

用户触发保存（Ctrl+Shift+S 或菜单）
    │
    ▼
[前端] SaveLayoutDialog 弹出，用户输入名称
    │
    ▼
[前端] layoutApi.layoutSave({ name, tree: layoutStore.layoutTree })
    │  Tauri invoke('layout_save', { name, tree: JSON 序列化的 LayoutNode })
    │
    ▼
[后端] layout_save command
    │  验证 name（非空，≤50字符）
    │  验证 layouts.len() < 50
    │  生成 id = uuid::new_v4()
    │  构造 SavedLayout { id, name, created_at, updated_at, tree }
    │  layout_store.append(saved_layout)
    │  → tauri_plugin_store: store.set('layouts', updated_list).save()
    │
    ▼
[后端] return Ok(new_layout_id)
    │
    ▼
[前端] Toast 提示「布局已保存：{name}」

---

【加载流程】

用户在布局管理器点击「加载」
    │
    ▼
[前端] 弹出确认框「加载布局将关闭当前所有面板，确认继续？」
    │  用户确认
    │
    ▼
[前端] 对所有 panelStore 中 isAlive 的面板执行 terminalApi.terminalKill(terminalId)
    │  panelStore.clearAll()
    │
    ▼
[前端] layoutApi.layoutLoad({ layoutId })
    │  Tauri invoke('layout_load', { layout_id })
    │
    ▼
[后端] layout_load command
    │  layout_store.get(layout_id)
    │  return Ok(SavedLayout)
    │
    ▼
[前端] layoutStore.setLayoutTree(savedLayout.tree)
    │  LayoutRenderer 根据新树重新渲染所有面板
    │  每个 TerminalPane 挂载时触发 terminal_create（复用 6.1 流程）
    │  若工作目录不存在，terminal_create 后端回退到 Home 目录，前端显示黄色警告
```

### 6.4 窗口复制流程

```
用户右键面板 → 选择「复制此面板」（或 Ctrl+Shift+D）
    │
    ▼
[前端] TerminalContextMenu 弹出方向选择（水平/垂直）
    │
    ▼
[前端] terminalApi.terminalGetCwd({ terminalId: panel.terminalId })
    │  Tauri invoke('terminal_get_cwd', { terminal_id })
    │
    ▼
[后端] terminal_get_cwd command
    │  PtyManager.get_cwd(terminal_id)
    │  → 平台特定实现：
    │    Windows: 查询进程句柄工作目录
    │    Linux/macOS: 读取 /proc/{pid}/cwd 符号链接
    │
    ▼
[后端] return Ok(cwd_path)
    │  若失败 return Err → 前端使用 panelState.currentWorkingDirectory 作为回退
    │
    ▼
[前端] 获得 sourceCwd（当前工作目录）
    │  layoutStore.duplicatePanel(panelId, direction, {
    │    shellType: sourceLeaf.shellType,
    │    shellPath: sourceLeaf.shellPath,
    │    workingDirectory: sourceCwd,
    │  })
    │  → 在布局树中将目标叶子节点替换为 SplitNode {
    │      direction,
    │      ratio: 0.5,
    │      first: 原叶子节点,
    │      second: 新 TerminalLeaf { id: newId, shellType, shellPath, workingDirectory: sourceCwd }
    │    }
    │
    ▼
[前端] 新 TerminalPane 挂载 → 触发 terminal_create（复用 6.1 流程）
    │  复用 workingDirectory = sourceCwd
    │  焦点转移到新面板
```

---

## 7. 任务分配

### 7.1 基础设施任务（DEV-A 完成，需先完成以解除其他开发者的阻塞）

- [x] 初始化 Tauri v2 + React + Vite 项目骨架（`src-tauri/` + `src/` 基础结构）
- [x] 配置 `Cargo.toml`（portable-pty、tauri-plugin-store、serde、uuid、tokio 依赖）
- [x] 配置 `package.json`（@tauri-apps/api、xterm、xterm-addon-fit、zustand、typescript）
- [x] 创建 `src/types/layout.ts`（所有布局相关 TypeScript 类型）
- [x] 创建 `src/types/terminal.ts`（PanelState、ShellInfo、TerminalOutputEvent 类型）
- [x] 创建 `src/styles/global.css`（深色主题变量：`--bg-app: #1a1a1a`、`--bg-panel: #0d0d0d`、`--border: #333`）
- [x] 创建 `src/ipc/terminalApi.ts` 骨架（类型签名 + invoke 调用，不含业务逻辑）
- [x] 创建 `src/ipc/layoutApi.ts` 骨架
- [x] 创建 `src-tauri/src/commands/mod.rs` 聚合模块
- [x] 创建 `src-tauri/src/lib.rs` Tauri Builder 配置（注册所有 command，注册 tauri-plugin-store）
- [x] 创建 `src-tauri/capabilities/default.json` 权限声明

---

### 7.2 开发者任务

#### DEV-A - 架构师 / 全栈

- **任务清单**：
  - [ ] 完成上方基础设施任务（优先级最高）
  - [ ] 实现 `src-tauri/src/store/layout_store.rs`（SavedLayout CRUD，tauri-plugin-store 读写）
  - [ ] 实现 `src-tauri/src/commands/layout.rs`（layout_save / layout_list / layout_load / layout_delete / layout_rename / settings_get / settings_save）
  - [ ] 实现 `src-tauri/src/commands/terminal.rs` 中的 `terminal_create` 和 `terminal_kill` 命令（协调 PtyManager）
  - [ ] 实现 `src-tauri/src/main.rs`（注册所有 command，on_window_close 全量 PTY kill）
  - [ ] 验证 portable-pty 在 Windows 上的可用性（spike）

- **文件范围**：
  - `src/types/layout.ts`（新建）
  - `src/types/terminal.ts`（新建）
  - `src/styles/global.css`（新建）
  - `src/ipc/terminalApi.ts`（新建）
  - `src/ipc/layoutApi.ts`（新建）
  - `src-tauri/src/main.rs`（新建）
  - `src-tauri/src/lib.rs`（新建）
  - `src-tauri/src/commands/mod.rs`（新建）
  - `src-tauri/src/commands/terminal.rs`（新建，与 DEV-B 协作：DEV-A 负责 create/kill，DEV-B 负责 write/resize/get_cwd）
  - `src-tauri/src/commands/layout.rs`（新建）
  - `src-tauri/src/store/mod.rs`（新建）
  - `src-tauri/src/store/layout_store.rs`（新建）
  - `src-tauri/Cargo.toml`（新建）
  - `src-tauri/tauri.conf.json`（新建）
  - `src-tauri/capabilities/default.json`（新建）
  - `package.json`（新建）
  - `vite.config.ts`（新建）
  - `tsconfig.json`（新建）
  - `index.html`（新建）

---

#### DEV-B - Rust 后端开发

**前置依赖**：等待 DEV-A 完成 `src-tauri/src/commands/terminal.rs` 骨架和 `Cargo.toml`

- **任务清单**：
  - [ ] 实现 `src-tauri/src/pty/process.rs`（PtyProcess：单个 PTY 进程封装，含后台读取线程，emit terminal:output / terminal:exit 事件）
  - [ ] 实现 `src-tauri/src/pty/manager.rs`（PtyManager：HashMap<String, PtyProcess> 进程注册表，线程安全 Mutex 包装，提供 create / write / resize / kill / get_cwd / kill_all 方法）
  - [ ] 实现 `src-tauri/src/shell/detector.rs`（按平台探测可用 Shell：Windows 探测 PowerShell 5.1/7/CMD/Git Bash；macOS/Linux 探测 Bash/Zsh/Fish）
  - [ ] 在 `src-tauri/src/commands/terminal.rs` 中补全 `terminal_write`、`terminal_resize`、`terminal_get_cwd`、`shell_list_available` 命令
  - [ ] 实现 PTY 进程泄漏防护（PtyManager::kill_all，在 on_window_close 和 Rust Drop 中调用）
  - [ ] 处理 Shell 进程异常退出场景（emit terminal:exit 事件，exitCode 非 0）

- **文件范围**：
  - `src-tauri/src/pty/mod.rs`（新建）
  - `src-tauri/src/pty/process.rs`（新建）
  - `src-tauri/src/pty/manager.rs`（新建）
  - `src-tauri/src/shell/mod.rs`（新建）
  - `src-tauri/src/shell/detector.rs`（新建）
  - `src-tauri/src/commands/terminal.rs`（与 DEV-A 协作，DEV-B 补全 write/resize/get_cwd/shell_list）

---

#### DEV-C - 前端开发 A（布局引擎）

**前置依赖**：等待 DEV-A 完成 `src/types/layout.ts`、`src/ipc/terminalApi.ts`

- **任务清单**：
  - [ ] 实现 `src/utils/layoutTree.ts`（布局树纯函数操作：insertNode / removeNode / updateRatio / duplicateNode / countLeaves / findLeafById）
  - [ ] 实现 `src/store/layoutStore.ts`（Zustand store：布局树状态、splitPanel / closePanel / updateRatio / duplicatePanel / setLayoutTree actions）
  - [ ] 实现 `src/store/panelStore.ts`（Zustand store：PanelState Map、addPanel / updateCwd / setDead / removePanel / clearAll actions）
  - [ ] 实现 `src/hooks/useResize.ts`（分割线拖拽逻辑：onMouseDown + rAF 节流 + onMouseUp 触发 terminal_resize）
  - [ ] 实现 `src/components/layout/SplitHandle.tsx`（可拖拽分割线：4px 宽度，hover 高亮 #555，调用 useResize）
  - [ ] 实现 `src/components/layout/SplitPane.tsx`（分割节点渲染：根据 direction 使用 flex-row/flex-col，根据 ratio 计算 flex-basis）
  - [ ] 实现 `src/components/layout/LayoutRenderer.tsx`（递归渲染入口：LayoutNode → SplitPane 或 PanelContainer）
  - [ ] 实现 `src/components/layout/PanelContainer.tsx`（叶子节点容器：面板最小尺寸限制 80×80px，传递 panelId 给子组件）
  - [ ] 实现面板分割后焦点自动移至新面板逻辑

- **文件范围**：
  - `src/utils/layoutTree.ts`（新建）
  - `src/store/layoutStore.ts`（新建）
  - `src/store/panelStore.ts`（新建）
  - `src/hooks/useResize.ts`（新建）
  - `src/components/layout/LayoutRenderer.tsx`（新建）
  - `src/components/layout/SplitPane.tsx`（新建）
  - `src/components/layout/SplitHandle.tsx`（新建）
  - `src/components/layout/PanelContainer.tsx`（新建）

---

#### DEV-D - 前端开发 B（终端 UI + 布局管理）

**前置依赖**：等待 DEV-A 完成 `src/types/terminal.ts`、`src/ipc/terminalApi.ts`、`src/ipc/layoutApi.ts`；等待 DEV-C 完成 `PanelContainer.tsx`（集成 TerminalPane）

- **任务清单**：
  - [ ] 实现 `src/hooks/useTerminal.ts`（xterm.js Terminal 生命周期：实例创建、FitAddon attach、listen terminal:output / terminal:exit、onData → terminal_write、onResize → terminal_resize）
  - [ ] 实现 `src/components/terminal/TerminalPane.tsx`（xterm.js 容器：attach 到 DOM ref，WebGL 优先降级 Canvas，ResizeObserver 触发 fit/resize）
  - [ ] 实现 `src/components/terminal/TerminalHeader.tsx`（面板头部：Shell 图标、当前目录名缩略（≤20字符 + 截断省略）、水平分割/垂直分割/复制/关闭 4 个按钮）
  - [ ] 实现 `src/components/terminal/TerminalContextMenu.tsx`（右键菜单：水平分割、垂直分割、复制此面板、关闭面板）
  - [ ] 实现 `src/utils/shellIcons.ts`（shellType 字符串 → SVG 图标名/颜色映射）
  - [ ] 实现 `src/styles/terminal.css`（xterm.js 容器样式：100% 宽高、overflow hidden、padding 0）
  - [ ] 实现 `src/components/layout-manager/SaveLayoutDialog.tsx`（保存布局弹窗：名称输入框、默认名称「布局 N」、验证 1-50 字符）
  - [ ] 实现 `src/components/layout-manager/LayoutListItem.tsx`（布局列表单条：名称 + 保存时间 + 面板数 + 加载/重命名/删除按钮）
  - [ ] 实现 `src/components/layout-manager/LayoutManagerDrawer.tsx`（布局管理侧边抽屉：调用 layoutApi.layoutList()，渲染 LayoutListItem 列表，处理加载确认框）
  - [ ] 实现 `src/components/titlebar/TitleBar.tsx`（无边框标题栏：拖拽区域、「布局」菜单按钮触发 LayoutManagerDrawer、保存布局按钮）
  - [ ] 实现 `src/App.tsx`（根组件：LayoutRenderer + TitleBar 组合，初始化默认单面板布局）
  - [ ] 实现 `src/hooks/useKeyboardShortcuts.ts`（全局快捷键：Ctrl+Shift+H/V/D/W/S/L，Ctrl+Tab / Ctrl+Shift+Tab）
  - [ ] 实现面板关闭时最后一个面板保护逻辑（禁用关闭按钮或二次确认）
  - [ ] 实现工作目录不存在时的黄色警告提示（布局加载场景）
  - [ ] 实现 Shell 进程退出后「重新启动」按钮功能

- **文件范围**：
  - `src/hooks/useTerminal.ts`（新建）
  - `src/hooks/useKeyboardShortcuts.ts`（新建）
  - `src/components/terminal/TerminalPane.tsx`（新建）
  - `src/components/terminal/TerminalHeader.tsx`（新建）
  - `src/components/terminal/TerminalContextMenu.tsx`（新建）
  - `src/components/layout-manager/SaveLayoutDialog.tsx`（新建）
  - `src/components/layout-manager/LayoutListItem.tsx`（新建）
  - `src/components/layout-manager/LayoutManagerDrawer.tsx`（新建）
  - `src/components/titlebar/TitleBar.tsx`（新建）
  - `src/App.tsx`（新建）
  - `src/main.tsx`（新建）
  - `src/utils/shellIcons.ts`（新建）
  - `src/styles/terminal.css`（新建）

---

## 8. 文件分配矩阵

| 文件路径 | 操作 | 负责人 | 备注 |
|---------|------|--------|------|
| `src/types/layout.ts` | 新建 | DEV-A | 所有布局相关 TS 类型，其他开发者只读 |
| `src/types/terminal.ts` | 新建 | DEV-A | 运行时面板状态和事件类型，其他开发者只读 |
| `src/ipc/terminalApi.ts` | 新建 | DEV-A | invoke 封装骨架，DEV-D 使用 |
| `src/ipc/layoutApi.ts` | 新建 | DEV-A | invoke 封装骨架，DEV-D 使用 |
| `src/styles/global.css` | 新建 | DEV-A | 深色主题 CSS 变量 |
| `src/utils/layoutTree.ts` | 新建 | DEV-C | 布局树纯函数操作 |
| `src/utils/shellIcons.ts` | 新建 | DEV-D | Shell 图标映射 |
| `src/store/layoutStore.ts` | 新建 | DEV-C | Zustand 布局树 store |
| `src/store/panelStore.ts` | 新建 | DEV-C | Zustand 运行时面板 store |
| `src/hooks/useResize.ts` | 新建 | DEV-C | 分割线拖拽 rAF 节流 |
| `src/hooks/useTerminal.ts` | 新建 | DEV-D | xterm.js 生命周期 hook |
| `src/hooks/useKeyboardShortcuts.ts` | 新建 | DEV-D | 全局快捷键绑定 |
| `src/components/layout/LayoutRenderer.tsx` | 新建 | DEV-C | 递归渲染布局树 |
| `src/components/layout/SplitPane.tsx` | 新建 | DEV-C | 分割节点渲染 |
| `src/components/layout/SplitHandle.tsx` | 新建 | DEV-C | 可拖拽分割线 |
| `src/components/layout/PanelContainer.tsx` | 新建 | DEV-C | 叶子面板容器（集成点） |
| `src/components/terminal/TerminalPane.tsx` | 新建 | DEV-D | xterm.js 实例封装 |
| `src/components/terminal/TerminalHeader.tsx` | 新建 | DEV-D | 面板头部 UI |
| `src/components/terminal/TerminalContextMenu.tsx` | 新建 | DEV-D | 右键菜单 |
| `src/components/layout-manager/SaveLayoutDialog.tsx` | 新建 | DEV-D | 保存布局弹窗 |
| `src/components/layout-manager/LayoutListItem.tsx` | 新建 | DEV-D | 布局列表项 |
| `src/components/layout-manager/LayoutManagerDrawer.tsx` | 新建 | DEV-D | 布局管理抽屉 |
| `src/components/titlebar/TitleBar.tsx` | 新建 | DEV-D | 无边框标题栏 |
| `src/App.tsx` | 新建 | DEV-D | 根组件 |
| `src/main.tsx` | 新建 | DEV-D | React 入口 |
| `src/styles/terminal.css` | 新建 | DEV-D | xterm.js 容器样式 |
| `src-tauri/src/main.rs` | 新建 | DEV-A | Tauri 应用入口 |
| `src-tauri/src/lib.rs` | 新建 | DEV-A | Tauri Builder + 插件注册 |
| `src-tauri/src/commands/mod.rs` | 新建 | DEV-A | commands 模块聚合 |
| `src-tauri/src/commands/terminal.rs` | 新建 | DEV-A + DEV-B | DEV-A 创建骨架(create/kill)，DEV-B 补全(write/resize/get_cwd/shell_list) |
| `src-tauri/src/commands/layout.rs` | 新建 | DEV-A | 布局 CRUD commands |
| `src-tauri/src/pty/mod.rs` | 新建 | DEV-B | PTY 模块聚合 |
| `src-tauri/src/pty/process.rs` | 新建 | DEV-B | 单个 PTY 进程封装 |
| `src-tauri/src/pty/manager.rs` | 新建 | DEV-B | PTY 进程注册表 |
| `src-tauri/src/shell/mod.rs` | 新建 | DEV-B | Shell 模块聚合 |
| `src-tauri/src/shell/detector.rs` | 新建 | DEV-B | Shell 可执行路径探测 |
| `src-tauri/src/store/mod.rs` | 新建 | DEV-A | store 模块聚合 |
| `src-tauri/src/store/layout_store.rs` | 新建 | DEV-A | tauri-plugin-store 封装 |
| `src-tauri/Cargo.toml` | 新建 | DEV-A | Rust 依赖声明 |
| `src-tauri/build.rs` | 新建 | DEV-A | Tauri 构建脚本 |
| `src-tauri/tauri.conf.json` | 新建 | DEV-A | Tauri 配置（窗口大小、标题栏、权限） |
| `src-tauri/capabilities/default.json` | 新建 | DEV-A | Tauri v2 权限声明白名单 |
| `package.json` | 新建 | DEV-A | 前端依赖（xterm、zustand、@tauri-apps/api 等） |
| `vite.config.ts` | 新建 | DEV-A | Vite 构建配置 |
| `tsconfig.json` | 新建 | DEV-A | TypeScript 编译配置 |
| `index.html` | 新建 | DEV-A | HTML 入口 |

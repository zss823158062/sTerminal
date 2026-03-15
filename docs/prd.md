# sTerminal - 产品需求文档 (PRD)

## 1. 项目概述

### 1.1 产品定位

sTerminal 是一款基于 Tauri 的本地桌面终端模拟器，参考 XTerminal 的核心设计理念，聚焦三个核心能力：多面板本地控制台、布局持久化保存与还原、终端窗口快速复制。目标是为开发者提供轻量、高效、可定制的本地终端环境。

### 1.2 目标用户

- 需要同时管理多个终端会话的开发者
- 习惯分屏工作流的后端/运维工程师
- 频繁切换固定工作布局的用户（如：前端开发区 + 服务启动区 + Git 操作区）

### 1.3 技术栈

| 层次 | 技术选型 | 说明 |
|------|---------|------|
| 桌面容器 | Tauri v2（Rust 后端 + 系统 WebView2） | 跨平台桌面应用框架，打包体积极小 |
| 终端渲染 | xterm.js | 业界标准 Web 终端模拟器 |
| 伪终端进程 | portable-pty（Rust crate） | 在 Rust 后端创建 PTY 进程，支持 PowerShell / CMD / Bash / Zsh |
| 前端框架 | React | UI 组件化管理 |
| 布局引擎 | 自定义二叉树 | 可拖拽分割面板 |
| 数据持久化 | tauri-plugin-store（本地 JSON） | 保存布局配置 |
| 构建工具 | Vite + Tauri CLI（@tauri-apps/cli） | 开发热重载 + 生产打包 |
| 后端语言 | Rust | Tauri 后端逻辑、PTY 管理、系统调用 |

---

## 2. 功能需求

### 2.1 功能清单

| 编号 | 功能模块 | 功能点 | 优先级 | 描述 |
|------|---------|--------|--------|------|
| F01 | 本地控制台 | 打开终端面板 | P0 | 在应用内启动本地 shell 进程，渲染为可交互终端 |
| F02 | 本地控制台 | 水平分割面板 | P0 | 将当前面板水平切分为上下两个面板 |
| F03 | 本地控制台 | 垂直分割面板 | P0 | 将当前面板垂直切分为左右两个面板 |
| F04 | 本地控制台 | 拖拽调整面板大小 | P0 | 拖动分割线，自由调整相邻面板的尺寸比例 |
| F05 | 本地控制台 | 关闭面板 | P0 | 关闭单个面板，同级面板自动占满空间 |
| F06 | 本地控制台 | 选择 Shell 类型 | P1 | 创建面板时可选择使用 PowerShell / CMD / Git Bash 等 |
| F07 | 本地控制台 | 设置工作目录 | P1 | 创建面板时可指定初始工作目录 |
| F08 | 布局保存 | 保存当前布局 | P0 | 将当前所有面板的数量、分割方向、大小比例序列化并命名保存 |
| F09 | 布局保存 | 查看已保存布局列表 | P0 | 展示所有已命名保存的布局 |
| F10 | 布局保存 | 加载布局 | P0 | 选择一个已保存布局，还原为对应的面板结构 |
| F11 | 布局保存 | 删除布局 | P1 | 删除一个已保存的布局记录 |
| F12 | 布局保存 | 重命名布局 | P2 | 对已保存的布局进行重命名 |
| F13 | 窗口复制 | 复制终端面板 | P0 | 基于指定面板的配置（shell 类型、工作目录），在旁边创建一个新面板 |
| F14 | 窗口复制 | 复制位置选择 | P1 | 复制后新面板出现在水平或垂直分割的方向由用户选择 |

### 2.2 功能详细描述

#### F01-F07 本地控制台

**用户故事**

> 作为开发者，我希望在一个桌面应用内打开多个本地终端，并能自由分割排布，这样我不需要再开多个原生终端窗口来回切换。

**交互流程**

1. 应用启动时，默认打开一个全屏终端面板，使用系统默认 Shell。
2. 用户右键面板或点击面板右上角工具栏，可选择「水平分割」或「垂直分割」。
3. 分割后，新面板启动一个新的 Shell 进程，焦点自动移至新面板。
4. 用户鼠标悬停于两面板之间的分割线，光标变为调整图标，可按住拖拽改变比例。
5. 点击面板右上角「×」关闭该面板，对应 Shell 进程同步终止，空间由同级面板填充。

**面板分割数据结构（概念）**

采用二叉树模型描述面板布局：每个节点要么是一个叶子节点（真实终端），要么是一个分割节点（含方向 + 比例 + 两个子节点）。

**边界条件**

- 只剩最后一个面板时，「关闭」按钮需禁用或二次确认，防止意外关闭应用。
- 面板最小尺寸设定为 80px × 80px，防止拖拽到无法操作的极小尺寸。
- Shell 进程异常退出时，面板显示「进程已退出（退出码 X）」提示，提供「重新启动」按钮。

---

#### F08-F12 布局保存

**用户故事**

> 作为有固定工作流的开发者，我希望把今天配好的「3 面板布局」保存下来，明天打开应用直接还原，不需要重新手动分割。

**交互流程 - 保存布局**

1. 用户点击顶部菜单栏「布局」→「保存当前布局」，或使用快捷键 `Ctrl+Shift+S`。
2. 弹出对话框，输入布局名称（默认填入「布局 1」、「布局 2」递增命名）。
3. 确认后，将当前布局树序列化为 JSON，追加到本地持久化存储。
4. Toast 提示「布局已保存：[名称]」。

**交互流程 - 加载布局**

1. 用户点击顶部菜单栏「布局」→「布局管理」，或使用快捷键 `Ctrl+Shift+L`。
2. 弹出布局列表面板，展示所有已保存布局的名称和保存时间。
3. 点击某条布局，弹出确认框：「加载布局将关闭当前所有面板，确认继续？」
4. 确认后，关闭所有现有 Shell 进程，按保存的布局树重建面板结构，每个叶子节点启动新 Shell 进程（使用保存时的 shell 类型和工作目录）。

**边界条件**

- 布局名称不允许为空，最长 50 个字符。
- 工作目录恢复时，若目录已不存在，则回退到用户 Home 目录，并给出黄色警告提示。
- 最多保存 50 个布局，超出后提示用户删除旧布局。

---

#### F13-F14 窗口复制

**用户故事**

> 作为开发者，我在一个面板中已经 cd 进了某个项目目录，我想快速再开一个相同目录的终端，而不需要重新手动 cd 进去。

**交互流程**

1. 用户右键目标面板，选择「复制此面板」，或点击面板工具栏的「复制」图标。
2. 弹出小型选项框，选择复制方向：「水平复制（左右并排）」或「垂直复制（上下并排）」。
3. 新面板在对应方向创建，继承来源面板的 Shell 类型和工作目录（通过 `portable-pty` 获取当前进程的 cwd）。
4. 新面板启动后，执行 `cd <来源工作目录>` 恢复工作目录，焦点转移到新面板。

**边界条件**

- 若来源 Shell 进程已退出，则使用来源面板记录的「初始工作目录」作为新面板的起始目录。
- 复制操作不复制来源面板的历史输出内容，新面板从空白状态启动。
- 复制后面板尺寸按 50/50 比例均分，用户可再手动拖拽调整。

---

## 3. 非功能需求

### 3.1 性能要求

- 应用启动时间（冷启动到首个终端可用）不超过 3 秒。
- 面板分割操作响应时间不超过 300ms。
- 布局保存/加载操作响应时间不超过 500ms。
- 终端输入响应延迟不超过 16ms（保证 60fps 流畅感）。
- 同时开启 10 个终端面板时，内存占用不超过 500MB。

### 3.2 兼容性要求

- **操作系统**：Windows 10/11（主要目标平台），macOS 12+，Linux（Ubuntu 20.04+）
- **Shell 支持**：
  - Windows：PowerShell 5.1+、PowerShell 7+、CMD、Git Bash
  - macOS/Linux：Bash、Zsh、Fish
- **屏幕分辨率**：最低支持 1280×720
- **Tauri 版本**：v2+
- **WebView2 Runtime**：Windows 需要 WebView2 Runtime（Win10 1803+ 需手动安装，Win11 内置）

### 3.3 安全性要求

- 使用 Tauri 天然沙箱隔离，前端无 Node.js 访问权限，渲染进程运行在纯 WebView2 环境中。
- 通过 Tauri invoke 命令系统暴露受限 API，后端使用 `#[tauri::command]` 宏声明白名单函数，渲染进程仅可调用明确注册的命令。
- 布局配置文件仅存储 Shell 类型、工作目录等配置信息，不存储任何终端历史输出内容。
- 不进行任何网络请求，不收集用户数据，完全本地运行。

---

## 4. UI/UX 设计

### 4.1 整体布局

```
┌─────────────────────────────────────────────────────────────┐
│  [应用标题栏] sTerminal          [布局▾] [设置] [最小化][×] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────┬──────────────────────────────┐   │
│  │  终端面板 A          │  终端面板 B                  │   │
│  │  [Shell图标] bash ×  │  [Shell图标] pwsh  [复制][×] │   │
│  │                      │                              │   │
│  │  $ _                 │  > _                         │   │
│  │                      ├──────────────────────────────┤   │
│  │                      │  终端面板 C                  │   │
│  │                      │  [Shell图标] bash  [复制][×] │   │
│  │                      │                              │   │
│  │                      │  $ _                         │   │
│  └──────────────────────┴──────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- **标题栏**：自定义无边框标题栏，内嵌「布局」菜单入口。
- **面板头部**（每个终端面板顶部）：显示 Shell 类型图标 + 当前目录名（缩略），右侧有「水平分割」「垂直分割」「复制」「关闭」四个操作图标。
- **分割线**：面板之间的分割条宽度 4px，hover 时高亮显示，支持拖拽。
- **整体配色**：深色主题（背景 `#1a1a1a`，面板背景 `#0d0d0d`，分割线 `#333`），后续可扩展主题切换。

### 4.2 关键交互

| 操作 | 触发方式 |
|------|---------|
| 水平分割当前面板 | 右键菜单 / 面板工具栏按钮 / `Ctrl+Shift+H` |
| 垂直分割当前面板 | 右键菜单 / 面板工具栏按钮 / `Ctrl+Shift+V` |
| 复制当前面板 | 右键菜单 / 面板工具栏按钮 / `Ctrl+Shift+D` |
| 关闭当前面板 | 面板工具栏「×」按钮 / `Ctrl+Shift+W` |
| 保存当前布局 | 顶部「布局」菜单 / `Ctrl+Shift+S` |
| 打开布局管理 | 顶部「布局」菜单 / `Ctrl+Shift+L` |
| 聚焦下一面板 | `Ctrl+Tab` |
| 聚焦上一面板 | `Ctrl+Shift+Tab` |

**布局管理浮层**

- 以侧边抽屉或居中弹窗形式展示。
- 列表项显示：布局名称 + 保存时间 + 面板数量。
- 每条布局右侧有「加载」「重命名」「删除」三个操作按钮。

---

## 5. 数据模型

### 5.1 布局树节点（LayoutNode）

布局使用递归二叉树结构描述，分为两种节点类型：

```typescript
// 叶子节点：真实终端面板
interface TerminalLeaf {
  type: 'terminal';
  id: string;            // 唯一面板 ID
  shellType: string;     // e.g. 'powershell', 'cmd', 'bash'
  shellPath: string;     // Shell 可执行文件完整路径
  workingDirectory: string; // 初始工作目录
}

// 分割节点：包含两个子节点
interface SplitNode {
  type: 'split';
  direction: 'horizontal' | 'vertical'; // horizontal = 左右，vertical = 上下
  ratio: number;         // 第一个子节点占比，范围 0.1 ~ 0.9
  first: LayoutNode;
  second: LayoutNode;
}

type LayoutNode = TerminalLeaf | SplitNode;
```

### 5.2 已保存布局记录（SavedLayout）

```typescript
interface SavedLayout {
  id: string;            // UUID
  name: string;          // 用户命名，如 "前端开发"
  createdAt: string;     // ISO 8601 时间戳
  updatedAt: string;     // ISO 8601 时间戳
  tree: LayoutNode;      // 完整布局树
}
```

### 5.3 持久化存储结构

使用 `tauri-plugin-store` 将以下结构存储在本地 JSON 文件中（路径：`userData/config.json`）：

```typescript
interface AppStore {
  layouts: SavedLayout[];     // 已保存的布局列表，最多 50 条
  lastLayout?: LayoutNode;    // 应用退出前的布局快照（可选，用于下次自动恢复）
  settings: {
    defaultShell: string;          // 默认 Shell 类型
    defaultWorkingDirectory: string; // 默认工作目录
  };
}
```

### 5.4 运行时面板状态（PanelState）

运行时在渲染进程内存中维护，不持久化：

```typescript
interface PanelState {
  id: string;
  ptyProcessId: number;      // portable-pty 进程 PID
  currentWorkingDirectory: string; // 实时工作目录（通过轮询 /proc 或 Shell 事件更新）
  isAlive: boolean;
}
```

---

## 6. 待确认事项

| 编号 | 问题 | 影响范围 | 优先级 |
|------|------|---------|--------|
| Q01 | 是否需要支持多窗口（多个独立的 Tauri WebView 窗口）？还是只在单窗口内分割面板？ | 架构设计 | 高 |
| Q02 | 布局加载时，是否恢复上次 Shell 的工作目录？还是每次都从默认目录启动？ | F10 布局加载 | 中 |
| Q03 | 是否需要「自动恢复上次布局」功能（即每次启动应用自动还原退出前的布局）？ | 启动体验 | 中 |
| Q04 | 面板头部是否需要显示实时工作目录？实时 cwd 获取方案（Shell 钩子 vs 轮询）对性能有影响，需确认是否必要。 | F01 面板头部 | 低 |
| Q05 | 是否支持 SSH 远程连接？（当前 PRD 只覆盖本地 Shell，后续可扩展） | 功能边界 | 低 |
| Q06 | 布局保存上限 50 条是否合理？是否需要支持导入/导出布局文件（用于多机同步）？ | F08 布局保存 | 低 |

---

## 7. 技术方案（头脑风暴产出）

### 7.1 推荐方案

**方案 A：自定义二叉树布局引擎 + Tauri v2 + Zustand**

完全自研分割面板组件，递归渲染 PRD 定义的 `LayoutNode` 二叉树；使用 Tauri CLI + Vite 一体化构建；Zustand 管理全局布局状态；Tauri invoke 命令系统隔离前后端通信。数据模型零偏差，序列化路径最短，打包体积远小于 Electron 方案，是三个方案中整体开发工作量最低的选择。

---

### 7.2 候选方案对比

| 维度 | 方案 A（推荐） | 方案 B | 方案 C |
|------|--------------|--------|--------|
| **布局引擎** | 自定义二叉树递归渲染 | allotment（VS Code 同款） | golden-layout / react-mosaic |
| **构建工具** | Vite + Tauri CLI | Vite + Tauri CLI | Vite + electron-builder |
| **状态管理** | Zustand | Zustand | Zustand / Redux |
| **数据模型对齐** | 完全对齐，零转换层 | 需双向转换层 | react-mosaic 基本对齐，golden-layout 差异大 |
| **拖拽分割** | 自研（onMouseDown + rAF 节流） | 开箱即用 | 开箱即用 |
| **序列化复杂度** | 低（直接 JSON.stringify 树） | 中（需 allotment state ↔ LayoutNode 映射） | 中~高（格式差异需适配） |
| **包体影响** | 最小（无额外布局库，Tauri ~2-10MB） | +~50KB gzip（Tauri ~2-10MB） | ~100MB+（Electron） |
| **16ms 响应保障** | 高（无中间层） | 中（适配层有微小开销） | 低（库内部调度不可控） |
| **预估复杂度** | 中 | 中 | 高 |

---

### 7.3 关键技术决策

| 决策项 | 选择 | 替代方案 | 理由 |
|--------|------|---------|------|
| **桌面框架** | Tauri v2 | Electron | 打包体积 ~2-10MB vs ~100MB+，内存占用更低，Rust 后端性能更强，天然沙箱隔离安全性更高 |
| **布局引擎** | 自定义二叉树递归组件 | allotment、golden-layout、react-mosaic | PRD 已定义完整的 `LayoutNode` 二叉树数据模型，自研实现零偏差、零转换层；引入第三方库反而需要额外适配成本 |
| **构建方案** | Tauri CLI + Vite | Vite + electron-builder 分离配置 | Tauri CLI 统一管理前端与 Rust 后端的构建、开发热重载和打包流程，无需手动协调；官方维护 |
| **状态管理** | Zustand | React Context、Redux | 树形状态频繁局部更新（resize 拖拽），Context 会导致全树重渲染；Zustand 无 boilerplate，支持 immer 不可变更新，轻量 |
| **xterm.js 渲染器** | WebGL Renderer（优先）降级 Canvas | 仅 Canvas Renderer | WebGL 渲染性能比 Canvas 高约 30%，可更稳定保障 16ms 底线；需在初始化阶段验证多实例 GPU 上下文限制，不可用时自动降级 Canvas |
| **IPC 设计** | Tauri invoke 命令系统（`terminal_write`、`terminal_resize` 等） | 通用命令接口（传入任意命令字符串） | Tauri `#[tauri::command]` 宏在编译期强类型检查，前端只能调用明确注册的后端函数，防止越权调用，符合最小权限原则 |
| **拖拽 resize 节流** | requestAnimationFrame 节流 | 无节流 / setTimeout | rAF 与屏幕刷新周期对齐，防止高频 mousemove 事件触发过多状态更新和 PTY resize 系统调用 |
| **进程管理** | portable-pty 按需创建 + on_window_close 全量清理 | 按需创建 + 不做清理 | portable-pty 是纯 Rust crate，无 native 编译问题；on_window_close 兜底确保 PTY 子进程不泄漏为孤儿进程 |

---

### 7.4 风险与缓解措施

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| **portable-pty 在 Windows 上的 PTY 可用性** | 低 | portable-pty 是纯 Rust crate，无 native 编译问题；将 Windows PTY 验证作为项目初始化第一步（spike），在 CI 中覆盖 Windows/macOS/Linux 三平台 |
| **Windows WebView2 Runtime 缺失（Win10 早期版本）** | 中 | 安装程序内嵌 WebView2 bootstrapper，自动检测并引导用户安装；Win10 1803+ 可通过 Windows Update 获取，Win11 内置 |
| **xterm.js 多实例 WebGL 上下文超限** | 中 | 初始化时检测 GPU 上下文数量，超限自动降级 Canvas Renderer；限制同时开启面板数（PRD 已定上限 10 个）|
| **xterm.js ↔ portable-pty resize 不同步（SIGWINCH）** | 中 | xterm.js `onResize` 事件触发时，通过 Tauri invoke 调用后端 `terminal_resize` 命令；拖拽结束后（mouseup）触发一次强制同步 |
| **布局加载时工作目录已不存在** | 低 | PRD 已定：回退到用户 Home 目录并显示黄色警告提示（F10 边界条件） |
| **PTY 进程泄漏（应用异常退出）** | 中 | Tauri `on_window_close` + Rust Drop trait 双重兜底，遍历所有 ptyProcessId 执行 kill |
| **渲染进程越权访问系统 API** | 低 | Tauri 天然隔离，渲染进程运行在纯 WebView2 沙箱中，无 Node.js 访问权限；后端仅通过 `#[tauri::command]` 白名单暴露函数 |

---

### 7.5 实施建议

**关键依赖顺序（建议按此顺序验证）**：

1. **portable-pty spike**：最先验证 Rust PTY 在 Windows 上的可用性，阻塞后续所有终端功能
2. **Tauri command 骨架**：建立后端 Tauri command 骨架（`terminal_create`、`terminal_write`、`terminal_resize`、`terminal_kill`、`layout_save`、`layout_load`），验证前后端 invoke 通信链路
3. **xterm.js 单实例渲染**：验证 WebGL Renderer 可用性，确定降级策略
4. **布局引擎**：实现二叉树递归渲染 + 分割线拖拽（rAF 节流）
5. **持久化层**：tauri-plugin-store 读写 `SavedLayout[]`

**技术约束与最佳实践**：

- Tauri command 函数命名使用 snake_case 格式：`terminal_write`、`terminal_resize`、`layout_save` 等，前端通过 `invoke('terminal_write', {...})` 调用，禁止动态构造命令名
- 布局序列化只持久化 `LayoutNode` 树结构（shellType、shellPath、workingDirectory、direction、ratio），严禁持久化终端历史输出
- 拖拽 resize 全程使用 `requestAnimationFrame` 节流，mousemove 回调内只更新中间变量，rAF 回调内统一 setState
- PTY 进程生命周期与面板生命周期严格绑定：面板关闭 → 立即 kill PTY；应用退出 → on_window_close 全量 kill
- 单窗口架构（锁定 Q01 答案）：所有面板共享一个 WebView 窗口，Tauri invoke 通信路径最简；多窗口支持留作后续扩展
- 面板最小尺寸强制 80×80px，防止 PTY resize 到零导致进程崩溃

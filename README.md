<p align="center">
  <img src="src-tauri/icons/icon.png" width="80" height="80" alt="sTerminal">
</p>

<h1 align="center">sTerminal</h1>

<p align="center">
  基于 Tauri 2 + React + xterm.js 的多面板本地终端模拟器
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2.x-blue" alt="Tauri">
  <img src="https://img.shields.io/badge/React-18-61dafb" alt="React">
  <img src="https://img.shields.io/badge/Rust-2021-orange" alt="Rust">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 功能特性

- **多面板分割** — 二叉树布局引擎，支持水平/竖直任意嵌套分割，拖拽分割线实时调整比例
- **Tab 管理** — 每个面板可包含多个终端 Tab，支持拖拽排序、跨面板合并、重命名
- **布局持久化** — 保存/加载命名布局（最多 50 条），一键覆盖保存或另存为新布局
- **Shell 自动检测** — 自动识别系统可用 Shell（PowerShell、cmd、bash、zsh、fish 等）
- **WebGL 渲染** — xterm.js WebGL 加速，流畅渲染大量终端输出
- **自定义标题栏** — 无边框窗口，显示当前绑定的布局名称
- **全局快捷键** — 分割、关闭、复制面板、保存布局、面板切换等

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+H` | 水平分割 |
| `Ctrl+Shift+V` | 竖直分割 |
| `Ctrl+Shift+D` | 复制面板 |
| `Ctrl+Shift+W` | 关闭面板 |
| `Ctrl+Shift+S` | 保存布局 |
| `Ctrl+Shift+L` | 布局管理 |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 切换焦点面板 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | React 18 + TypeScript 5 + Vite 5 |
| 状态管理 | Zustand 5 |
| 终端 | xterm.js 5 (WebGL) |
| 后端 | Rust (Tokio + portable-pty) |
| 持久化 | tauri-plugin-store |

## 项目结构

```
sTerminal/
├── src/                          # 前端源码
│   ├── components/
│   │   ├── layout/               # 布局引擎（递归渲染、分割容器、拖拽手柄）
│   │   ├── terminal/             # 终端面板、右键菜单、设置弹窗
│   │   ├── layout-manager/       # 布局管理抽屉、列表项、保存弹窗
│   │   └── titlebar/             # 自定义标题栏
│   ├── hooks/                    # useTerminal、useKeyboardShortcuts、useResize
│   ├── store/                    # Zustand store（layoutStore、panelStore）
│   ├── ipc/                      # Tauri IPC 封装（terminalApi、layoutApi）
│   ├── types/                    # TypeScript 类型定义
│   ├── utils/                    # 二叉树操作、Tab 拖拽状态机
│   └── styles/                   # 全局 CSS 变量、终端样式
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── commands/             # Tauri Commands（terminal_*、layout_*、settings_*）
│   │   ├── pty/                  # PTY 进程管理（PtyManager、PtyProcess）
│   │   ├── shell/                # 跨平台 Shell 检测
│   │   └── store/                # 布局/设置持久化（tauri-plugin-store）
│   └── icons/                    # 应用图标（ICO、PNG、ICNS）
```

## 开发

### 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.77
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) 2.x

### 启动开发

```bash
# 安装前端依赖
npm install

# 启动 Tauri 开发模式（前端 + 后端热重载）
npm run tauri dev
```

### 生产构建

```bash
npm run tauri build
```

## 架构

```
┌─────────────────────────────────────────┐
│              React 前端                  │
│  LayoutRenderer ← Zustand ← xterm.js   │
│         │                    ▲           │
│         │ invoke()           │ emit()    │
├─────────┼────────────────────┼───────────┤
│         ▼       Tauri IPC    │           │
│    Commands ──────────── Events          │
│         │                    ▲           │
│    PtyManager           terminal:output  │
│         │               terminal:exit    │
│    PtyProcess ──► portable-pty           │
│              Rust 后端                    │
└─────────────────────────────────────────┘
```

## License

[MIT](LICENSE)

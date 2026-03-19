/**
 * 单个终端会话
 */
export interface TerminalSession {
  /** 会话唯一 ID，UUID v4 格式 */
  id: string;
  /** Shell 类型标识符，如 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' */
  shellType: string;
  /** Shell 可执行文件完整路径，如 '/bin/bash' 或 'C:/Windows/System32/cmd.exe' */
  shellPath: string;
  /** 初始工作目录的绝对路径；加载布局时若目录不存在则回退到 Home 目录 */
  workingDirectory: string;
  /** 标签页显示名称，如 "控制台 1" */
  name?: string;
  /** 终端创建后自动执行的命令 */
  startupCommand?: string;
}

/**
 * 叶子节点 = Tab 组，包含 1+ 个终端会话，同一时间只显示一个
 */
export interface TerminalLeaf {
  /** 节点类型标识符，固定为 'terminal' */
  type: "terminal";
  /** 面板（组）唯一 ID，用于在布局树中定位 */
  id: string;
  /** 所有终端会话 */
  tabs: TerminalSession[];
  /** 当前激活的 tab ID */
  activeTabId: string;
}

/**
 * 分割节点：包含两个子面板和分割方向
 */
export interface SplitNode {
  /** 节点类型标识符，固定为 'split' */
  type: "split";
  /**
   * 分割方向
   * - 'horizontal'：左右分割（first 在左，second 在右）
   * - 'vertical'：上下分割（first 在上，second 在下）
   */
  direction: "horizontal" | "vertical";
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
export type LayoutNode = TerminalLeaf | SplitNode;

/**
 * 已保存的布局完整记录
 */
export interface SavedLayout {
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
  /** 该布局包含的叶子节点（终端面板）数量 */
  panelCount: number;
}

/**
 * 布局列表元数据（不含树结构，用于列表展示，减少传输量）
 */
export interface SavedLayoutMeta {
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
 * 常用命令
 */
export interface CommonCommand {
  /** 命令唯一 ID，UUID v4 格式 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 命令文本 */
  command: string;
}

/**
 * 命令分组
 */
export interface CommandGroup {
  /** 分组唯一 ID，UUID v4 格式 */
  id: string;
  /** 分组名称 */
  name: string;
  /** 分组下的命令列表 */
  commands: CommonCommand[];
}

/**
 * 持久化存储的完整数据结构（tauri-plugin-store 存储在 config.json）
 */
export interface AppStore {
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
export interface AppSettings {
  /** 默认 Shell 类型标识符，如 'powershell' | 'bash' */
  defaultShell: string;
  /** 默认 Shell 可执行文件完整路径 */
  defaultShellPath: string;
  /** 默认初始工作目录绝对路径，空字符串表示使用用户 Home 目录 */
  defaultWorkingDirectory: string;
  /** 常用命令分组列表 */
  commandGroups: CommandGroup[];
}

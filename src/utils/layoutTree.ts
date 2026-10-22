import type { LayoutNode, TerminalLeaf, TerminalSession, SplitNode } from "../types/layout";
import { useSettingsStore } from "../store/settingsStore";

/**
 * 生成唯一面板 ID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 统计布局树中叶子节点的数量
 */
export function countLeaves(tree: LayoutNode): number {
  if (tree.type === "terminal") return 1;
  return countLeaves(tree.first) + countLeaves(tree.second);
}

/**
 * 根据 ID 查找叶子节点，未找到返回 null
 */
export function findLeafById(
  tree: LayoutNode,
  id: string
): TerminalLeaf | null {
  if (tree.type === "terminal") {
    return tree.id === id ? tree : null;
  }
  return findLeafById(tree.first, id) ?? findLeafById(tree.second, id);
}

/**
 * 在目标叶子节点位置插入分割节点，返回新树。
 * position = "after"（默认）：目标叶子变为 first，newLeaf 变为 second。
 * position = "before"：newLeaf 变为 first，目标叶子变为 second。
 * 如果目标 ID 不存在，返回原树不变。
 */
export function insertNode(
  tree: LayoutNode,
  targetId: string,
  direction: "horizontal" | "vertical",
  newLeaf: TerminalLeaf,
  position: "before" | "after" = "after"
): LayoutNode {
  if (tree.type === "terminal") {
    if (tree.id !== targetId) return tree;
    const splitNode: SplitNode = {
      type: "split",
      direction,
      ratio: 0.5,
      first: position === "after" ? tree : newLeaf,
      second: position === "after" ? newLeaf : tree,
    };
    return splitNode;
  }
  return {
    ...tree,
    first: insertNode(tree.first, targetId, direction, newLeaf, position),
    second: insertNode(tree.second, targetId, direction, newLeaf, position),
  };
}

/**
 * 移除目标叶子节点，其同级节点提升到父节点位置，返回新树。
 * 如果树中只剩一个叶子节点，返回 null。
 * 如果目标 ID 不存在，返回原树不变。
 */
export function removeNode(
  tree: LayoutNode,
  targetId: string
): LayoutNode | null {
  if (tree.type === "terminal") {
    return tree.id === targetId ? null : tree;
  }

  // 检查 first 是否是目标
  if (tree.first.type === "terminal" && tree.first.id === targetId) {
    return tree.second;
  }
  // 检查 second 是否是目标
  if (tree.second.type === "terminal" && tree.second.id === targetId) {
    return tree.first;
  }

  // 递归向下找
  const newFirst = removeNode(tree.first, targetId);
  const newSecond = removeNode(tree.second, targetId);

  // first 子树中找到并移除了目标（newFirst 变为 null 表示该子树被整体移除）
  if (newFirst === null) return tree.second;
  // second 子树中找到并移除了目标
  if (newSecond === null) return tree.first;

  return {
    ...tree,
    first: newFirst,
    second: newSecond,
  };
}

/**
 * split 节点在布局树中的路径：从根出发每一步走 first 还是 second。
 * 空数组表示根节点自身。
 *
 * SplitNode 没有 id 字段（且不能加——会破坏已保存布局的向后兼容），
 * 因此用路径作为定位键。路径天然唯一，不像"first 子树的最左叶子 id"
 * 那样会在嵌套 split 之间发生碰撞。
 */
export type SplitPath = ReadonlyArray<"first" | "second">;

/**
 * 更新指定分割节点的 ratio，返回新树。
 * ratio 会被 clamp 到 [0.1, 0.9]。
 * 通过 path 从根逐层下钻定位目标 split 节点；路径无效则原样返回。
 */
export function updateRatio(
  tree: LayoutNode,
  path: SplitPath,
  newRatio: number
): LayoutNode {
  if (tree.type === "terminal") return tree;

  if (path.length === 0) {
    const clampedRatio = Math.min(0.9, Math.max(0.1, newRatio));
    return { ...tree, ratio: clampedRatio };
  }

  const [step, ...rest] = path;
  const child = tree[step];
  const newChild = updateRatio(child, rest, newRatio);
  if (newChild === child) return tree;

  return { ...tree, [step]: newChild };
}

/**
 * 收集布局树中所有叶子节点
 */
export function collectLeaves(tree: LayoutNode): TerminalLeaf[] {
  if (tree.type === "terminal") return [tree];
  return [...collectLeaves(tree.first), ...collectLeaves(tree.second)];
}

/**
 * 更新指定叶子节点的属性，返回新树
 */
export function updateLeafInTree(
  tree: LayoutNode,
  targetId: string,
  updates: Partial<Omit<TerminalLeaf, "type" | "id">>
): LayoutNode {
  if (tree.type === "terminal") {
    return tree.id === targetId ? { ...tree, ...updates } : tree;
  }
  return {
    ...tree,
    first: updateLeafInTree(tree.first, targetId, updates),
    second: updateLeafInTree(tree.second, targetId, updates),
  };
}

/**
 * 复制面板：在目标叶子节点旁按指定方向插入 newLeaf。
 * 等同于 insertNode，语义上表示复制操作。
 */
export function duplicateNode(
  tree: LayoutNode,
  targetId: string,
  direction: "horizontal" | "vertical",
  newLeaf: TerminalLeaf
): LayoutNode {
  return insertNode(tree, targetId, direction, newLeaf);
}

/**
 * 深拷贝布局树并为所有节点重新生成 ID。
 *
 * 用于「加载已保存布局」场景：保存的树里 leaf.id / session.id 是固化的旧 UUID，
 * 若直接塞进 store，这些 ID 会与 terminalInstances 缓存（以 session.id 为 key）中
 * 残留的脏实例（terminalId 已失效 / PTY 已 kill）撞 key，
 * 导致 acquireTerminal 返回旧壳、onData 因 terminalId 为空丢弃所有输入，
 * 表现为「加载布局后终端无法输入 / Ctrl+C 无反应」。
 *
 * 重新生成 ID 后，每次加载都是全新 key，必然新建 xterm + PTY 实例，从根上规避冲突。
 */
export function rekeyLayoutTree(tree: LayoutNode): LayoutNode {
  if (tree.type === "terminal") {
    // 旧 tabId → 新 tabId 映射，用于同步 activeTabId
    const idMap = new Map<string, string>();
    const newTabs = tree.tabs.map((session) => {
      const newId = generateId();
      idMap.set(session.id, newId);
      return { ...session, id: newId };
    });
    const newActiveTabId =
      idMap.get(tree.activeTabId) ?? newTabs[0]?.id ?? tree.activeTabId;
    return {
      ...tree,
      id: generateId(),
      tabs: newTabs,
      activeTabId: newActiveTabId,
    };
  }
  return {
    ...tree,
    first: rekeyLayoutTree(tree.first),
    second: rekeyLayoutTree(tree.second),
  };
}

/**
 * 创建一个新的终端会话
 * 未显式指定 shell 时，从全局设置读取默认值
 */
export function createSession(
  name: string,
  config?: Partial<Pick<TerminalSession, "shellType" | "shellPath" | "elevated" | "workingDirectory" | "startupCommand" | "transientStartupCommand">>
): TerminalSession {
  const { settings } = useSettingsStore.getState();

  return {
    id: generateId(),
    shellType: config?.shellType ?? (settings.defaultShell || "default"),
    shellPath: config?.shellPath ?? (settings.defaultShellPath || ""),
    workingDirectory: config?.workingDirectory ?? (settings.defaultWorkingDirectory || ""),
    name,
    ...(config?.elevated ? { elevated: true } : {}),
    ...(config?.startupCommand ? { startupCommand: config.startupCommand } : {}),
    ...(config?.transientStartupCommand
      ? { transientStartupCommand: config.transientStartupCommand }
      : {}),
  };
}

/**
 * 剥离树中所有 session 的瞬时字段，用于持久化前的清理。
 *
 * transientStartupCommand 只对当前这次终端创建有意义（如 claude --resume），
 * 写进布局会在下次加载时重复执行。
 */
export function stripTransient(tree: LayoutNode): LayoutNode {
  if (tree.type === "terminal") {
    return {
      ...tree,
      tabs: tree.tabs.map(({ transientStartupCommand: _omit, ...rest }) => rest),
    };
  }
  return {
    ...tree,
    first: stripTransient(tree.first),
    second: stripTransient(tree.second),
  };
}


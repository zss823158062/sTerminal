import type { LayoutNode, TerminalLeaf, TerminalSession, SplitNode } from "../types/layout";

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
 * 更新指定分割节点的 ratio，返回新树。
 * ratio 会被 clamp 到 [0.1, 0.9]。
 * 通过 splitNodeId 定位——这里 SplitNode 本身没有 id 字段，
 * 因此约定传入其 first 叶子的 id 作为定位键（最近的直接子叶子）。
 *
 * 注意：updateRatio 在 layoutStore 中通过直接遍历树结构来更新，
 * 本函数接受 splitNodeId（即该 split 节点下 first 子节点的 id），
 * 匹配 split 节点后更新 ratio。
 *
 * 实际上为了与 store 保持一致，这里改为：传入目标 splitNode 的
 * 内容特征来定位，但由于 SplitNode 无 id，故 store 侧直接传递路径。
 * 本函数提供一个"按引用替换"版本供 store 内部使用。
 */
export function updateRatio(
  tree: LayoutNode,
  targetSplitId: string,
  newRatio: number
): LayoutNode {
  const clampedRatio = Math.min(0.9, Math.max(0.1, newRatio));

  if (tree.type === "terminal") return tree;

  // 用 split 节点下 first 子节点的叶子 id 来定位
  // 如果 first 是叶子且 id 匹配，则此 split 节点是目标
  if (tree.first.type === "terminal" && tree.first.id === targetSplitId) {
    return { ...tree, ratio: clampedRatio };
  }

  return {
    ...tree,
    first: updateRatio(tree.first, targetSplitId, newRatio),
    second: updateRatio(tree.second, targetSplitId, newRatio),
  };
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
 * 创建一个新的终端会话
 */
export function createSession(
  name: string,
  config?: Partial<Pick<TerminalSession, "shellType" | "shellPath" | "workingDirectory" | "startupCommand">>
): TerminalSession {
  return {
    id: generateId(),
    shellType: config?.shellType ?? "default",
    shellPath: config?.shellPath ?? "",
    workingDirectory: config?.workingDirectory ?? "",
    name,
    ...(config?.startupCommand ? { startupCommand: config.startupCommand } : {}),
  };
}

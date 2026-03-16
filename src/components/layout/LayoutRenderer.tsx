import type { LayoutNode } from "../../types/layout";
import { SplitPane } from "./SplitPane";
import { PanelContainer } from "./PanelContainer";
import { TerminalPane } from "../terminal/TerminalPane";

interface LayoutRendererProps {
  node: LayoutNode;
}

/**
 * 递归渲染 LayoutNode 二叉树的入口组件。
 * - SplitNode → SplitPane（递归渲染两个子节点）
 * - TerminalLeaf → PanelContainer（叶子面板容器，内含 TerminalPane）
 */
export function LayoutRenderer({ node }: LayoutRendererProps) {
  if (node.type === "split") {
    return <SplitPane node={node} />;
  }

  return (
    <PanelContainer node={node}>
      <TerminalPane leaf={node} />
    </PanelContainer>
  );
}

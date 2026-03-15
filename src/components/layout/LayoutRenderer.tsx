/**
 * 占位 LayoutRenderer（DEV-C 负责完整实现）
 *
 * 此文件由 DEV-D 提供最小可用实现，确保 App.tsx 可以编译和运行。
 * 当 DEV-C 完成正式实现后，此文件将被替换。
 */
import React from "react";
import type { LayoutNode } from "../../types/layout";
import { TerminalPane } from "../terminal/TerminalPane";
import { useLayoutStore } from "../../store/layoutStore";

interface LayoutRendererProps {
  node: LayoutNode;
}

export const LayoutRenderer: React.FC<LayoutRendererProps> = ({ node }) => {
  const splitPanel = useLayoutStore((s) => s.splitPanel);
  const closePanel = useLayoutStore((s) => s.closePanel);
  const duplicatePanel = useLayoutStore((s) => s.duplicatePanel);
  const countLeaves = useLayoutStore((s) => s.countLeaves);

  if (node.type === "terminal") {
    return (
      <TerminalPane
        leaf={node}
        panelCount={countLeaves()}
        onSplitHorizontal={(id) => splitPanel(id, "horizontal")}
        onSplitVertical={(id) => splitPanel(id, "vertical")}
        onDuplicate={(id) => duplicatePanel(id, "horizontal")}
        onClose={(id) => closePanel(id)}
      />
    );
  }

  // SplitNode：根据 direction 布局两个子节点
  const isHorizontal = node.direction === "horizontal";
  const firstSize = `${node.ratio * 100}%`;
  const secondSize = `${(1 - node.ratio) * 100}%`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flexBasis: firstSize,
          flexShrink: 0,
          overflow: "hidden",
          minWidth: 80,
          minHeight: 80,
        }}
      >
        <LayoutRenderer node={node.first} />
      </div>
      {/* 分割线占位（DEV-C 实现拖拽逻辑） */}
      <div
        style={{
          flexShrink: 0,
          width: isHorizontal ? 4 : "100%",
          height: isHorizontal ? "100%" : 4,
          background: "var(--split-handle, #333)",
          cursor: isHorizontal ? "col-resize" : "row-resize",
        }}
      />
      <div
        style={{
          flexBasis: secondSize,
          flex: 1,
          overflow: "hidden",
          minWidth: 80,
          minHeight: 80,
        }}
      >
        <LayoutRenderer node={node.second} />
      </div>
    </div>
  );
};

export default LayoutRenderer;

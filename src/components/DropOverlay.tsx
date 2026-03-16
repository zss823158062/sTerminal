/**
 * 面板拖放区域视觉指示器
 *
 * 根据鼠标悬停的边缘区域，渲染半透明覆盖层提示用户拖放后的分屏方向。
 */

export type DropZone = "left" | "right" | "top" | "bottom" | "center" | null;

interface DropOverlayProps {
  zone: DropZone;
}

const zoneStyles: Record<string, React.CSSProperties> = {
  left: { left: 0, top: 0, width: "50%", height: "100%" },
  right: { right: 0, top: 0, width: "50%", height: "100%" },
  top: { left: 0, top: 0, width: "100%", height: "50%" },
  bottom: { left: 0, bottom: 0, width: "100%", height: "50%" },
  center: { left: 0, top: 0, width: "100%", height: "100%" },
};

export function DropOverlay({ zone }: DropOverlayProps) {
  if (!zone) return null;

  const className =
    zone === "center" ? "drop-overlay drop-overlay--center" : "drop-overlay";

  return <div className={className} style={zoneStyles[zone]} />;
}

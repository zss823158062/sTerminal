import React, { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  type?: "success" | "warning" | "error" | "info";
  duration?: number;
  onDismiss: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = "info",
  duration = 3000,
  onDismiss,
}) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  const colorMap: Record<string, string> = {
    success: "#4ade80",
    warning: "#facc15",
    error: "#f87171",
    info: "#60a5fa",
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: `translateX(-50%) translateY(${visible ? "0" : "20px"})`,
        zIndex: 99999,
        background: "#252525",
        border: `1px solid ${colorMap[type]}`,
        borderRadius: 6,
        padding: "8px 16px",
        color: colorMap[type],
        fontSize: 13,
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease, transform 200ms ease",
        whiteSpace: "nowrap",
        maxWidth: 400,
      }}
    >
      {message}
    </div>
  );
};

export default Toast;

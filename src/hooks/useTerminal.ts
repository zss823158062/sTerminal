import { useEffect, useState, useCallback, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import {
  acquireTerminal,
  detachTerminal,
  destroyTerminal,
  getTerminal,
  subscribeTerminal,
} from "../terminal/terminalInstances";

interface UseTerminalOptions {
  panelId: string;
  shellPath: string;
  workingDirectory: string;
  startupCommand?: string;
  /** 是否给 PTY 注入代理环境变量；仅在创建/重启时生效 */
  proxyEnabled?: boolean;
  /** 是否经 sudo 以管理员身份运行；仅在创建/重启时生效 */
  elevated?: boolean;
  containerRef: RefObject<HTMLDivElement>;
}

interface UseTerminalReturn {
  terminal: Terminal | null;
  terminalId: string | null;
  isAlive: boolean;
  exitCode: number | undefined;
  restart: () => void;
  copySelection: () => void;
  pasteFromClipboard: () => void;
}

export function useTerminal({
  panelId,
  shellPath,
  workingDirectory,
  startupCommand,
  proxyEnabled,
  elevated,
  containerRef,
}: UseTerminalOptions): UseTerminalReturn {
  const [, forceUpdate] = useState(0);
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    // 获取或创建终端实例
    const managed = acquireTerminal(
      panelId,
      shellPath,
      workingDirectory,
      startupCommand,
      proxyEnabled,
      elevated
    );

    // 把持久容器挂到当前 host
    host.appendChild(managed.container);

    // 初始 fit
    requestAnimationFrame(() => {
      try {
        managed.fitAddon.fit();
      } catch {
        // 容器不可见时忽略
      }
    });

    // 监听容器尺寸变化（rAF 合并：拖分割线时一帧内可能触发多次，
    // 避免重复 fit 引发多余的 clearTextureAtlas 与 PTY resize IPC）
    let fitRaf: number | null = null;
    const observer = new ResizeObserver(() => {
      if (fitRaf !== null) return;
      fitRaf = requestAnimationFrame(() => {
        fitRaf = null;
        try {
          managed.fitAddon.fit();
        } catch {
          // ignore
        }
      });
    });
    observer.observe(host);

    // 订阅终端状态变更（isAlive / exitCode）
    const unsub = subscribeTerminal(panelId, () =>
      forceUpdate((n) => n + 1)
    );

    return () => {
      observer.disconnect();
      if (fitRaf !== null) cancelAnimationFrame(fitRaf);
      unsub();
      // 只做分离，不销毁；若 5s 内没有重新 acquire 则自动销毁
      detachTerminal(panelId);
    };
    // restartKey 变化时重新执行（重启终端）
    // proxyEnabled 故意不在依赖里：它只在 spawn 时决定注入哪些环境变量，
    // 放进依赖会让切换开关触发一次无意义的 detach/re-acquire（PTY 并不会重建）。
    // 运行中的会话由 applyProxyToRunning 单独处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, shellPath, workingDirectory, startupCommand, restartKey]);

  const managed = getTerminal(panelId);

  const restart = useCallback(() => {
    destroyTerminal(panelId);
    setRestartKey((k) => k + 1);
  }, [panelId]);

  const copySelection = useCallback(() => {
    const term = getTerminal(panelId)?.terminal;
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(console.error);
    }
  }, [panelId]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const term = getTerminal(panelId)?.terminal;
      if (term) term.paste(text);
    } catch (err) {
      console.error("[useTerminal] Paste failed:", err);
    }
  }, [panelId]);

  return {
    terminal: managed?.terminal ?? null,
    terminalId: managed?.terminalId ?? null,
    isAlive: managed?.isAlive ?? true,
    exitCode: managed?.exitCode,
    restart,
    copySelection,
    pasteFromClipboard,
  };
}

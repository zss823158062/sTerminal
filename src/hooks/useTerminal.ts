import { useEffect, useState, useCallback, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import {
  acquireTerminal,
  detachTerminal,
  destroyTerminal,
  getTerminal,
  subscribeTerminal,
} from "../terminal/terminalInstances";
import { terminalWrite } from "../ipc/terminalApi";

interface UseTerminalOptions {
  panelId: string;
  shellPath: string;
  workingDirectory: string;
  startupCommand?: string;
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
  containerRef,
}: UseTerminalOptions): UseTerminalReturn {
  const [, forceUpdate] = useState(0);
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    // 获取或创建终端实例
    const managed = acquireTerminal(panelId, shellPath, workingDirectory, startupCommand);

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

    // 监听容器尺寸变化
    const observer = new ResizeObserver(() => {
      try {
        managed.fitAddon.fit();
      } catch {
        // ignore
      }
    });
    observer.observe(host);

    // 订阅终端状态变更（isAlive / exitCode）
    const unsub = subscribeTerminal(panelId, () =>
      forceUpdate((n) => n + 1)
    );

    return () => {
      observer.disconnect();
      unsub();
      // 只做分离，不销毁；若 5s 内没有重新 acquire 则自动销毁
      detachTerminal(panelId);
    };
    // restartKey 变化时重新执行（重启终端）
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
      const id = getTerminal(panelId)?.terminalId;
      if (id) {
        terminalWrite(id, new TextEncoder().encode(text)).catch(
          console.error
        );
      }
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

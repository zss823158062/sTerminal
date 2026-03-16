import { useEffect, useRef, useState, useCallback, type RefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { WebglAddon } from "@xterm/addon-webgl";
import { listen } from "@tauri-apps/api/event";
import { terminalCreate, terminalWrite, terminalResize, terminalKill } from "../ipc/terminalApi";
import type { TerminalOutputEvent, TerminalExitEvent } from "../types/terminal";

interface UseTerminalOptions {
  panelId: string;
  shellPath: string;
  workingDirectory: string;
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
  containerRef,
}: UseTerminalOptions): UseTerminalReturn {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [isAlive, setIsAlive] = useState(true);
  const [exitCode, setExitCode] = useState<number | undefined>(undefined);
  // track restart trigger
  const [restartKey, setRestartKey] = useState(0);

  const restart = useCallback(() => {
    setIsAlive(true);
    setExitCode(undefined);
    setRestartKey((k) => k + 1);
  }, []);

  const copySelection = useCallback(() => {
    const term = terminalRef.current;
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection).catch(console.error);
    }
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const id = terminalIdRef.current;
      if (id) {
        terminalWrite(id, new TextEncoder().encode(text)).catch(console.error);
      }
    } catch (err) {
      console.error("[useTerminal] Paste failed:", err);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ---- 1. 创建 xterm.js Terminal 实例 ----
    const term = new Terminal({
      theme: {
        background: "#0d0d0d",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        cursorAccent: "#0d0d0d",
        black: "#1a1a1a",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#34d399",
        white: "#e0e0e0",
        brightBlack: "#555",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#6ee7b7",
        brightWhite: "#f5f5f5",
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: "block",
      allowProposedApi: true,
      scrollback: 5000,
    });
    terminalRef.current = term;

    // ---- 2. attach FitAddon ----
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    // ---- 3. open terminal 到 DOM ----
    term.open(container);

    // ---- 3.5. 拦截 Ctrl+Shift+C/V 用于复制粘贴 ----
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (event.ctrlKey && event.shiftKey) {
        if (event.code === "KeyC") {
          copySelection();
          return false;
        }
        if (event.code === "KeyV") {
          pasteFromClipboard();
          return false;
        }
      }
      return true;
    });

    // ---- 4. 尝试 WebglAddon，失败降级 Canvas ----
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch (_e) {
      // WebGL 不可用，xterm 自动使用 Canvas renderer
    }

    // ---- 5. 初始 fit（延迟到浏览器完成布局后执行）----
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch (_e) { /* 容器不可见时忽略 */ }
    });

    // ---- 6. 调用后端创建 PTY ----
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let mounted = true;

    const init = async () => {
      try {
        const { cols, rows } = term;
        const id = await terminalCreate(shellPath, workingDirectory, cols, rows);
        if (!mounted) {
          // 组件已卸载，立即 kill
          terminalKill(id).catch(console.error);
          return;
        }
        terminalIdRef.current = id;
        setTerminalId(id);

        // ---- 7. 监听 terminal:output 事件 ----
        unlistenOutput = await listen<TerminalOutputEvent>("terminal:output", (event) => {
          if (event.payload.terminalId !== id) return;
          term.write(new Uint8Array(event.payload.data));
        });

        // ---- 8. 监听 terminal:exit 事件 ----
        unlistenExit = await listen<TerminalExitEvent>("terminal:exit", (event) => {
          if (event.payload.terminalId !== id) return;
          if (mounted) {
            setIsAlive(false);
            setExitCode(event.payload.exitCode);
          }
        });
      } catch (err) {
        console.error(`[useTerminal] Failed to create terminal for panel ${panelId}:`, err);
      }
    };

    init();

    // ---- 9. xterm.onData → terminalWrite ----
    const dataDisposable = term.onData((data) => {
      const id = terminalIdRef.current;
      if (!id) return;
      const bytes = new TextEncoder().encode(data);
      terminalWrite(id, bytes).catch(console.error);
    });

    // ---- 10. xterm.onResize → terminalResize ----
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      const id = terminalIdRef.current;
      if (!id) return;
      terminalResize(id, cols, rows).catch(console.error);
    });

    // ---- 11. ResizeObserver 监听容器尺寸变化 ----
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
        } catch (_e) {
          // 容器不可见时 fit 可能抛异常，忽略
        }
      }
    });
    observer.observe(container);

    // ---- cleanup ----
    return () => {
      mounted = false;
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      if (unlistenExit) unlistenExit();
      const id = terminalIdRef.current;
      if (id) {
        terminalKill(id).catch(console.error);
      }
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminalIdRef.current = null;
    };
    // restartKey 变化时重新执行整个 effect（重启）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, shellPath, workingDirectory, restartKey]);

  return {
    terminal: terminalRef.current,
    terminalId,
    isAlive,
    exitCode,
    restart,
    copySelection,
    pasteFromClipboard,
  };
}

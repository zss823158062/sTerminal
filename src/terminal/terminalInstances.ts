/**
 * 终端实例缓存
 *
 * 将 xterm + PTY 生命周期从 React 组件中解耦。
 * 组件 mount/unmount 只做 DOM 挂载/卸载，不销毁终端实例。
 * 终端仅在 tab 关闭或显式 restart 时才销毁。
 */

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import {
  terminalCreate,
  terminalWrite,
  terminalResize,
  terminalKill,
  getStartupDir,
} from "../ipc/terminalApi";
import { useSettingsStore, settingsReady } from "../store/settingsStore";
import type {
  TerminalOutputEvent,
  TerminalExitEvent,
} from "../types/terminal";

export interface ManagedTerminal {
  sessionId: string;
  /** 持久 DOM 容器，xterm 渲染在这里，会被 reparent 到不同的 host */
  container: HTMLDivElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  terminalId: string | null;
  isAlive: boolean;
  exitCode: number | undefined;
}

/** session ID → 实例 */
const cache = new Map<string, ManagedTerminal>();
/** session ID → 清理函数 */
const cleanupFns = new Map<string, () => void>();
/** session ID → 延迟销毁定时器 */
const pendingDestroy = new Map<string, ReturnType<typeof setTimeout>>();
/** session ID → 状态变更监听器 */
const stateListeners = new Map<string, Set<() => void>>();

/** 组件 detach 后等待多久才真正销毁（ms） */
const DESTROY_DELAY = 5_000;

/** 终端字体默认值 */
export const DEFAULT_FONT_FAMILY =
  '"JetBrainsMono NFM", "JetBrainsMono NF", "Cascadia Code", "Fira Code", "JetBrains Mono", Consolas, "Courier New", monospace';
export const DEFAULT_FONT_SIZE = 13;
// lineHeight 保持 1.0：WebGL 渲染器下非整数行高会导致每行 Y 坐标取整
// 产生 ±1px 抖动（尤其在 Claude Code / Droid 这类 Ink/React TUI 重绘密集场景）
export const DEFAULT_LINE_HEIGHT = 1.0;

function notifyListeners(sessionId: string) {
  stateListeners.get(sessionId)?.forEach((fn) => fn());
}

// ── 公共 API ──

/** 重新 fit 所有活跃终端并强制刷新渲染（弹窗关闭等场景） */
export function refitAll() {
  for (const managed of cache.values()) {
    try {
      managed.fitAddon.fit();
      // 清纹理图集 + 强制刷新，修复 WebGL 渲染偏移与字形错乱
      managed.terminal.clearTextureAtlas();
      managed.terminal.refresh(0, managed.terminal.rows - 1);
    } catch {
      // ignore
    }
  }
}

/** 订阅终端状态变更（isAlive / exitCode） */
export function subscribeTerminal(
  sessionId: string,
  cb: () => void
): () => void {
  if (!stateListeners.has(sessionId)) {
    stateListeners.set(sessionId, new Set());
  }
  stateListeners.get(sessionId)!.add(cb);
  return () => {
    stateListeners.get(sessionId)?.delete(cb);
  };
}

/** 读取已缓存的终端（不创建） */
export function getTerminal(
  sessionId: string
): ManagedTerminal | undefined {
  return cache.get(sessionId);
}

/**
 * 获取或创建终端实例。
 * 如有缓存直接返回（取消 pending destroy）；否则新建 xterm + PTY。
 */
export function acquireTerminal(
  sessionId: string,
  shellPath: string,
  workingDirectory: string,
  startupCommand?: string
): ManagedTerminal {
  // 取消待销毁定时器
  const timer = pendingDestroy.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pendingDestroy.delete(sessionId);
  }

  const existing = cache.get(sessionId);
  if (existing) return existing;

  // ── 创建持久 DOM 容器 ──
  const container = document.createElement("div");
  container.className = "terminal-container";
  container.style.cssText = "flex:1;overflow:hidden;min-height:0;";

  // ── 读取用户字体设置（若设置尚未加载则回退默认值）──
  const { settings: currentSettings, loaded: settingsLoaded } =
    useSettingsStore.getState();
  const fontFamily =
    (settingsLoaded && currentSettings.fontFamily?.trim()) ||
    DEFAULT_FONT_FAMILY;
  const fontSize =
    (settingsLoaded && currentSettings.fontSize) || DEFAULT_FONT_SIZE;
  const lineHeight =
    (settingsLoaded && currentSettings.lineHeight) || DEFAULT_LINE_HEIGHT;

  // ── 创建 xterm ──
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
    fontFamily,
    fontSize,
    lineHeight,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: "block",
    allowProposedApi: true,
    scrollback: 5000,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // Unicode 11：修正 CJK / Emoji / Nerd Fonts powerline 符号的宽度判断
  // 避免 Claude Code / Droid 等 TUI 在重绘时出现输入栏左漂
  try {
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";
  } catch (err) {
    console.warn("[terminal] Unicode11Addon load failed:", err);
  }

  term.open(container);

  // 复制粘贴拦截（与 Windows Terminal 行为一致）
  const doPaste = () => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text && managed.terminalId) {
          terminalWrite(
            managed.terminalId,
            new TextEncoder().encode(text)
          ).catch(console.error);
        }
      })
      .catch(console.error);
  };

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true;

    if (event.ctrlKey && event.shiftKey) {
      // Ctrl+Shift+C → 复制
      if (event.code === "KeyC") {
        const selection = term.getSelection();
        if (selection)
          navigator.clipboard.writeText(selection).catch(console.error);
        return false;
      }
      // Ctrl+Shift+V → 粘贴
      if (event.code === "KeyV") {
        event.preventDefault(); // 阻止浏览器默认 paste 事件，避免双重粘贴
        doPaste();
        return false;
      }
    }

    if (event.ctrlKey && !event.shiftKey && !event.altKey) {
      // Ctrl+C → 有选区时复制，否则发送 SIGINT（默认行为）
      if (event.code === "KeyC" && term.hasSelection()) {
        navigator.clipboard
          .writeText(term.getSelection())
          .catch(console.error);
        term.clearSelection();
        return false;
      }
      // Ctrl+V → 粘贴（CMD 等不支持 Ctrl+Shift+V 的 shell）
      if (event.code === "KeyV") {
        event.preventDefault(); // 阻止浏览器默认 paste 事件，避免双重粘贴
        doPaste();
        return false;
      }
    }

    return true;
  });

  // WebGL addon（降级安全）
  let webglAddon: WebglAddon | undefined;
  try {
    webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => {
      webglAddon?.dispose();
      webglAddon = undefined;
    });
    term.loadAddon(webglAddon);
  } catch {
    // Canvas fallback
  }

  const managed: ManagedTerminal = {
    sessionId,
    container,
    terminal: term,
    fitAddon,
    terminalId: null,
    isAlive: true,
    exitCode: undefined,
  };

  cache.set(sessionId, managed);

  // ── 创建 PTY ──
  let unlistenOutput: (() => void) | undefined;
  let unlistenExit: (() => void) | undefined;
  let destroyed = false;

  const init = async () => {
    try {
      // 等待设置从后端加载完成，确保能读到用户配置的默认 shell
      await settingsReady;

      // 设置加载完成后，若字体配置与创建时不同则应用到 xterm
      // （首个终端可能在 settings 加载前被创建，此时用的是默认字体）
      const loadedSettings = useSettingsStore.getState().settings;
      const effectiveFontFamily =
        loadedSettings.fontFamily?.trim() || DEFAULT_FONT_FAMILY;
      const effectiveFontSize = loadedSettings.fontSize || DEFAULT_FONT_SIZE;
      const effectiveLineHeight =
        loadedSettings.lineHeight || DEFAULT_LINE_HEIGHT;
      if (term.options.fontFamily !== effectiveFontFamily) {
        term.options.fontFamily = effectiveFontFamily;
      }
      if (term.options.fontSize !== effectiveFontSize) {
        term.options.fontSize = effectiveFontSize;
      }
      if (term.options.lineHeight !== effectiveLineHeight) {
        term.options.lineHeight = effectiveLineHeight;
      }

      // await 恢复后 rAF 的 fit 可能尚未执行，手动 fit 确保尺寸准确
      try { fitAddon.fit(); } catch { /* 容器不可见时忽略 */ }

      // CLI 启动目录优先（consume-once，仅首个终端生效）
      const cliDir = await getStartupDir();

      const { settings } = useSettingsStore.getState();
      const effectiveShellPath = shellPath || settings.defaultShellPath || "";
      const effectiveWorkDir = cliDir || workingDirectory || settings.defaultWorkingDirectory || "";
      const { cols, rows } = term;
      const id = await terminalCreate(
        effectiveShellPath,
        effectiveWorkDir,
        cols,
        rows
      );
      if (destroyed) {
        terminalKill(id).catch(console.error);
        return;
      }
      managed.terminalId = id;

      // PTY 就绪后再 fit 一次，确保 onResize 能发送给 PTY
      try { fitAddon.fit(); } catch { /* ignore */ }

      // 执行启动命令
      if (startupCommand) {
        setTimeout(() => {
          terminalWrite(id, new TextEncoder().encode(startupCommand + "\r")).catch(console.error);
        }, 300);
      }

      unlistenOutput = await listen<TerminalOutputEvent>(
        "terminal:output",
        (event) => {
          if (event.payload.terminalId !== id) return;
          term.write(new Uint8Array(event.payload.data));
        }
      );

      unlistenExit = await listen<TerminalExitEvent>(
        "terminal:exit",
        (event) => {
          if (event.payload.terminalId !== id) return;
          managed.isAlive = false;
          managed.exitCode = event.payload.exitCode;
          notifyListeners(sessionId);
        }
      );
    } catch (err) {
      console.error(
        `[terminalInstances] Failed to create PTY for ${sessionId}:`,
        err
      );
    }
  };

  init();

  // xterm → PTY write
  const dataDisposable = term.onData((data) => {
    const id = managed.terminalId;
    if (!id) return;
    terminalWrite(id, new TextEncoder().encode(data)).catch(console.error);
  });

  // xterm resize → PTY resize + 清纹理图集（避免 WebGL 字形缓存错乱）
  const resizeDisposable = term.onResize(({ cols, rows }) => {
    try {
      term.clearTextureAtlas();
    } catch {
      // ignore
    }
    const id = managed.terminalId;
    if (!id) return;
    terminalResize(id, cols, rows).catch(console.error);
  });

  // 保存清理函数
  cleanupFns.set(sessionId, () => {
    destroyed = true;
    dataDisposable.dispose();
    resizeDisposable.dispose();
    if (unlistenOutput) unlistenOutput();
    if (unlistenExit) unlistenExit();
    const id = managed.terminalId;
    if (id) terminalKill(id).catch(console.error);
    term.dispose();
  });

  return managed;
}

/**
 * 从 DOM 分离终端容器，并延迟销毁。
 * 如果在 DESTROY_DELAY 内被 acquireTerminal 重新获取，则取消销毁。
 */
export function detachTerminal(sessionId: string) {
  const entry = cache.get(sessionId);
  if (entry?.container.parentElement) {
    entry.container.parentElement.removeChild(entry.container);
  }

  // 延迟销毁：给 React reconciliation 留出时间完成 remount
  const timer = setTimeout(() => {
    pendingDestroy.delete(sessionId);
    destroyTerminal(sessionId);
  }, DESTROY_DELAY);
  pendingDestroy.set(sessionId, timer);
}

/**
 * 立即销毁终端实例（tab 关闭 / restart 时调用）
 */
export function destroyTerminal(sessionId: string) {
  // 取消待销毁定时器
  const timer = pendingDestroy.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pendingDestroy.delete(sessionId);
  }

  const cleanup = cleanupFns.get(sessionId);
  if (cleanup) cleanup();

  cleanupFns.delete(sessionId);
  cache.delete(sessionId);
  stateListeners.delete(sessionId);
}

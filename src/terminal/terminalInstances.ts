/**
 * 终端实例缓存
 *
 * 将 xterm + PTY 生命周期从 React 组件中解耦。
 * 组件 mount/unmount 只做 DOM 挂载/卸载，不销毁终端实例。
 * 终端仅在 tab 关闭或显式 restart 时才销毁。
 */

import { Terminal, type IWindowsPty } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import {
  terminalCreate,
  terminalWrite,
  terminalResize,
  terminalKill,
  getStartupDir,
  windowsBuildNumber,
} from "../ipc/terminalApi";
import { useSettingsStore, settingsReady } from "../store/settingsStore";
import { noteOutput, noteTerminalExit, noteCommandDone, forgetSession } from "./activity";
import { buildProxyEnv, buildProxySwitchCommand } from "../utils/proxyEnv";
import type { TerminalExitEvent } from "../types/terminal";

export interface ManagedTerminal {
  sessionId: string;
  /** 持久 DOM 容器，xterm 渲染在这里，会被 reparent 到不同的 host */
  container: HTMLDivElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  terminalId: string | null;
  isAlive: boolean;
  exitCode: number | undefined;
  /**
   * PTY 里实际运行的 shell 可执行文件路径（由 terminal_create 回传）。
   * PTY 就绪前为 null。判断 shell 语法时用这个，不要用 session.shellType
   */
  shellPath: string | null;
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

// ── ConPTY 兼容信息 ──

/** 全局只查一次；非 Windows 解析为 undefined */
let windowsPtyInfo: Promise<IWindowsPty | undefined> | null = null;

/**
 * 获取 xterm 的 windowsPty 配置。
 *
 * Windows 上 ConPTY 自己维护一份屏幕缓冲区，只把差量编码成 VT 发出来，
 * xterm 必须按同样的规则处理 resize，两份屏幕状态才能保持一致。告知
 * ConPTY 构建号后 xterm 会：增加行数时把新增行算进 scrollback（与 ConPTY
 * 一致，否则行被替换导致内容丢失/错位）；build < 21376 时关闭 reflow。
 */
function getWindowsPty(): Promise<IWindowsPty | undefined> {
  if (!windowsPtyInfo) {
    windowsPtyInfo = windowsBuildNumber()
      .then((buildNumber) =>
        buildNumber === null
          ? undefined
          : { backend: "conpty" as const, buildNumber }
      )
      .catch(() => undefined);
  }
  return windowsPtyInfo;
}

// ── WebGL 纹理图集重建 ──

/** 待执行的全量补重绘 rAF 句柄 */
let refreshAllRaf: number | null = null;

/**
 * 重建所有终端的 WebGL 纹理图集。
 *
 * 只能全量重建，不能单独重建某一个终端：xterm 让字体/字号/主题/DPR 相同的
 * 终端共用同一份图集（CharAtlasCache），clearTextureAtlas 清掉的是这份共享
 * 图集，却只重置调用者自己的渲染模型。其他终端的顶点缓存仍指向旧纹理坐标，
 * 而 _updateModel 会跳过内容没变的格子，refresh 也纠正不了——它们会采样到
 * 别的终端新排进图集的字形，表现为碎字，直到 resize 清掉模型才恢复。
 *
 * 时序很讲究，两步都不能省、也不能换顺序：
 *
 * 1) clearTextureAtlas 必须【同步】执行。图集里的字形是按旧 cell 尺寸/DPR
 *    光栅化的，而渲染器在本帧内就会用新参数绘制；晚一帧清空就会有一帧拿
 *    旧字形填新 cell，表现为字形被挤压/重叠成一团乱码。
 *
 * 2) refresh 必须【延后一帧】补上。清空图集后渲染器只重绘"脏行"，未变脏
 *    的行会从空图集采样导致文本整片消失（emoji 走独立纹理路径所以会残留
 *    下来）。等几何/DPI 在渲染层落定后再全量重绘才有效。
 *
 * 触发源：onResize、WebGL 加载/丢失，以及 installAtlasInvalidationListeners()
 * 覆盖的"尺寸没变但渲染上下文已失效"场景。
 */
export function rebuildAllAtlases() {
  for (const managed of cache.values()) {
    try {
      managed.terminal.clearTextureAtlas();
    } catch {
      // ignore
    }
  }

  if (refreshAllRaf !== null) cancelAnimationFrame(refreshAllRaf);
  refreshAllRaf = requestAnimationFrame(() => {
    refreshAllRaf = null;
    // 回调时再遍历：期间销毁的终端已移出 cache，不会打到已 dispose 的实例
    for (const managed of cache.values()) {
      try {
        managed.terminal.refresh(0, managed.terminal.rows - 1);
      } catch {
        // ignore
      }
    }
  });
}

/** 图集失效监听是否已安装（防重复安装） */
let invalidationListenersInstalled = false;

/**
 * 安装纹理图集失效监听（全局一次，在 App 挂载时调用）。
 *
 * 要解决的问题：WebGL 纹理图集会在【尺寸不变】的情况下失效，这类场景
 * 永远等不到 onResize，画面会一直坏着直到用户手动拖动窗口改尺寸。
 * 已知触发源：
 *
 * - WebView2 在窗口失焦/被遮挡/最小化时会主动释放不可见表面的显存。
 *   恢复可见时 WebGL 上下文仍然活着（不触发 onContextLoss），但纹理内容
 *   已是垃圾。这是"点一下窗口内容就乱码"最常见的成因。
 * - DPI 变化（跨显示器拖动、系统缩放调整）：图集按旧 devicePixelRatio
 *   光栅化，但 CSS 尺寸不变，因此不会触发 onResize。
 * - 字体加载完成：新字体替换 fallback 字形后旧图集失效。
 *
 * 这些事件都很低频（用户级操作），重建图集的开销可以忽略，宁可多重建
 * 也不要漏。
 *
 * @returns 卸载所有监听的函数
 */
export function installAtlasInvalidationListeners(): () => void {
  if (invalidationListenersInstalled) return () => {};
  invalidationListenersInstalled = true;

  const disposers: Array<() => void> = [];

  // ── 页面可见性：最小化/恢复、切换虚拟桌面、锁屏解锁 ──
  const onVisibility = () => {
    if (document.visibilityState === "visible") rebuildAllAtlases();
  };
  document.addEventListener("visibilitychange", onVisibility);
  disposers.push(() =>
    document.removeEventListener("visibilitychange", onVisibility)
  );

  // ── WebView 层面的焦点：点击窗口恢复焦点时 ──
  const onWindowFocus = () => rebuildAllAtlases();
  window.addEventListener("focus", onWindowFocus);
  disposers.push(() => window.removeEventListener("focus", onWindowFocus));

  // ── 页面从 back/forward cache 恢复（WebView2 偶发走这条路）──
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) rebuildAllAtlases();
  };
  window.addEventListener("pageshow", onPageShow);
  disposers.push(() => window.removeEventListener("pageshow", onPageShow));

  // ── DPI 变化：监听 devicePixelRatio 对应的 media query ──
  // resolution 查询在 DPR 跨过阈值时触发；每次触发后要重新绑定，
  // 因为新的 DPR 需要一个新的查询条件。
  let dprMql: MediaQueryList | null = null;
  let dprDisposed = false;
  const onDprChange = () => {
    rebuildAllAtlases();
    bindDprListener();
  };
  const bindDprListener = () => {
    if (dprDisposed) return;
    if (dprMql) dprMql.removeEventListener("change", onDprChange);
    try {
      dprMql = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`
      );
      dprMql.addEventListener("change", onDprChange);
    } catch {
      dprMql = null;
    }
  };
  bindDprListener();
  disposers.push(() => {
    dprDisposed = true;
    dprMql?.removeEventListener("change", onDprChange);
    dprMql = null;
  });

  // ── 字体加载完成：新字形替换 fallback 后旧图集失效 ──
  if (document.fonts) {
    const onFontsDone = () => rebuildAllAtlases();
    document.fonts.addEventListener("loadingdone", onFontsDone);
    disposers.push(() =>
      document.fonts.removeEventListener("loadingdone", onFontsDone)
    );
  }

  // ── Tauri 窗口事件：比 WebView 的 focus 更可靠，且能拿到缩放变化 ──
  // 异步注册，用标志位保证 dispose 早于注册完成时也能正确清理。
  let tauriDisposed = false;
  const tauriUnlisteners: Array<() => void> = [];
  const registerTauri = async () => {
    try {
      const win = getCurrentWindow();

      const unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
        if (focused) rebuildAllAtlases();
      });
      const unlistenScale = await win.onScaleChanged(() => {
        rebuildAllAtlases();
      });

      if (tauriDisposed) {
        unlistenFocus();
        unlistenScale();
        return;
      }
      tauriUnlisteners.push(unlistenFocus, unlistenScale);
    } catch (err) {
      // 非 Tauri 环境（浏览器里跑 vite dev）忽略，上面的 DOM 监听已够用
      console.warn("[terminal] Tauri window listeners unavailable:", err);
    }
  };
  registerTauri();
  disposers.push(() => {
    tauriDisposed = true;
    tauriUnlisteners.forEach((fn) => fn());
    tauriUnlisteners.length = 0;
  });

  return () => {
    disposers.forEach((fn) => fn());
    invalidationListenersInstalled = false;
  };
}

// ── 公共 API ──

/** 重新 fit 所有活跃终端并强制刷新渲染（弹窗关闭等场景） */
export function refitAll() {
  for (const managed of cache.values()) {
    try {
      // 尺寸有变化时 fit() 会同步触发 onResize，图集重建与补重绘都在
      // 那里统一处理（见 rebuildAllAtlases 的时序说明），此处不要重复清图集。
      managed.fitAddon.fit();
      // 尺寸没变则 onResize 不会触发，但弹窗遮挡期间的画面可能已失效，
      // 仍需强制重绘一次（不清图集——字形尺寸没变，图集是有效的）。
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
 *
 * @param proxyEnabled 是否给该 PTY 注入代理环境变量（地址取自全局设置）
 * @param elevated 是否经 sudo 以管理员身份运行
 */
export function acquireTerminal(
  sessionId: string,
  shellPath: string,
  workingDirectory: string,
  startupCommand?: string,
  proxyEnabled?: boolean,
  elevated?: boolean
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
  // 注：GPU 加速（WebGL）的开关不在这里读——首个终端可能早于设置加载完成，
  // 必须等 settingsReady 后再决定，见下方 WebGL addon 段。

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

  // Web 链接识别：仅在 Ctrl+左键 时通过系统默认浏览器打开，避免误触
  try {
    const webLinks = new WebLinksAddon((event, uri) => {
      if (!event.ctrlKey) return;
      openUrl(uri).catch((err) =>
        console.error("[terminal] openUrl failed:", err)
      );
    });
    term.loadAddon(webLinks);
  } catch (err) {
    console.warn("[terminal] WebLinksAddon load failed:", err);
  }

  term.open(container);

  // OSC 133 shell 集成标记（由后端 shell/integration.rs 注入）。
  // 只关心 D：命令结束。没有集成的 shell 不会产生该序列，活动检测会自动
  // 回退到静止超时。必须在任何 PTY 输出写入之前注册。
  const osc133Disposable = term.parser.registerOscHandler(133, (data) => {
    if (data === "A") return true;
    if (data.startsWith("D")) {
      const code = Number.parseInt(data.slice(2), 10);
      noteCommandDone(sessionId, Number.isNaN(code) ? 0 : code);
      return true;
    }
    // B / C / P 等不处理，交给其他 handler
    return false;
  });

  // 复制粘贴拦截（与 Windows Terminal 行为一致）
  const doPaste = () => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) term.paste(text);
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
      // Ctrl+Shift+R → 强制重绘（应用级快捷键，不要透传给 shell）
      // 返回 false 只阻止 xterm 写 PTY，事件仍会冒泡到 document 的全局监听
      if (event.code === "KeyR") {
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

  // 实例是否已被销毁。声明在此处（而非 PTY 段）是因为下面的 WebGL
  // 异步加载链也要读它，避免依赖 TDZ 的时序巧合。
  let destroyed = false;

  // WebGL addon（可关闭 + 降级安全）
  //
  // 不加载时 xterm 用内置 DOM 渲染器：性能较低，但完全不涉及纹理图集，
  // 可彻底规避图集失效导致的字形错乱（个别机器上的兜底手段）。
  //
  // 时机上有两层延后：
  // - 等 settingsReady：首个终端可能在设置加载完成前就被创建，此时读到的
  //   gpuAcceleration 是默认值，必须等真实配置到位再决定加不加载，否则
  //   用户关掉 GPU 加速后第一个终端仍会是 WebGL。
  // - 再等一帧：term.open() 之后容器尺寸/DPI 可能还未稳定，立即加载会让
  //   首屏字形从尚未就绪的纹理图集采样，出现碎片化乱码且必须等 resize 才恢复。
  let webglAddon: WebglAddon | undefined;
  settingsReady
    .then(() => {
      if (destroyed) return;

      const { settings: s, loaded } = useSettingsStore.getState();
      // 仅在用户显式关闭时才走 DOM 渲染器
      if (loaded && s.gpuAcceleration === false) return;

      requestAnimationFrame(() => {
        if (destroyed) return;
        try {
          webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            webglAddon?.dispose();
            webglAddon = undefined;
            // 降级到 DOM 渲染器后需重建图集，否则丢失瞬间的画面会残留
            rebuildAllAtlases();
          });
          term.loadAddon(webglAddon);
          // 切换渲染器后图集要重建（全量：新终端可能接入了其他终端在用的共享图集）
          rebuildAllAtlases();
        } catch {
          // WebGL 不可用 → 保持 DOM 渲染器
        }
      });
    })
    .catch(() => {
      // 设置加载失败 → 保持 DOM 渲染器（保守选择）
    });

  const managed: ManagedTerminal = {
    sessionId,
    container,
    terminal: term,
    fitAddon,
    terminalId: null,
    isAlive: true,
    exitCode: undefined,
    shellPath: null,
  };

  cache.set(sessionId, managed);

  // ── 创建 PTY ──
  let unlistenExit: (() => void) | undefined;

  const init = async () => {
    try {
      // 等待设置从后端加载完成，确保能读到用户配置的默认 shell
      await settingsReady;

      // ConPTY 兼容配置必须在 PTY 产生任何输出之前设好
      const windowsPty = await getWindowsPty();
      if (windowsPty) term.options.windowsPty = windowsPty;

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

      // 代理环境变量：仅在该控制台开关打开且全局配置了地址时注入
      const proxyEnv = proxyEnabled ? buildProxyEnv(settings) : {};
      const hasProxyEnv = Object.keys(proxyEnv).length > 0;

      // PTY 输出通道在 spawn 之前建好：读线程的第一包数据就有接收方，
      // 不会像事件广播那样在 listen 注册完成前被丢弃
      const output = new Channel<ArrayBuffer>();
      output.onmessage = (data) => {
        if (destroyed) return;
        term.write(new Uint8Array(data));
        // 后台活动检测：打未读标记，并在持续输出结束后提醒
        noteOutput(sessionId);
      };

      const { cols, rows } = term;
      const created = await terminalCreate(
        effectiveShellPath,
        effectiveWorkDir,
        cols,
        rows,
        output,
        hasProxyEnv ? proxyEnv : undefined,
        elevated
      );
      const id = created.terminalId;
      if (destroyed) {
        terminalKill(id).catch(console.error);
        return;
      }
      managed.terminalId = id;
      // 后端可能探测出与请求不同的 shell（请求为空时），记录实际值
      managed.shellPath = created.shellPath;

      // PTY 就绪后再 fit 一次，确保 onResize 能发送给 PTY
      try { fitAddon.fit(); } catch { /* ignore */ }

      // 执行启动命令
      if (startupCommand) {
        setTimeout(() => {
          terminalWrite(id, new TextEncoder().encode(startupCommand + "\r")).catch(console.error);
        }, 300);
      }

      unlistenExit = await listen<TerminalExitEvent>(
        "terminal:exit",
        (event) => {
          if (event.payload.terminalId !== id) return;
          managed.isAlive = false;
          managed.exitCode = event.payload.exitCode;
          noteTerminalExit(sessionId);
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

  // xterm resize → PTY resize + 重建纹理图集（避免 WebGL 字形缓存错乱）
  const resizeDisposable = term.onResize(({ cols, rows }) => {
    rebuildAllAtlases();
    const id = managed.terminalId;
    if (!id) return;
    terminalResize(id, cols, rows).catch(console.error);
  });

  // 保存清理函数
  cleanupFns.set(sessionId, () => {
    destroyed = true;
    forgetSession(sessionId);
    osc133Disposable.dispose();
    dataDisposable.dispose();
    resizeDisposable.dispose();
    if (unlistenExit) unlistenExit();
    const id = managed.terminalId;
    if (id) terminalKill(id).catch(console.error);
    term.dispose();
  });

  return managed;
}

/**
 * 把代理开关应用到运行中的终端。
 *
 * 环境变量无法从外部改写已启动的进程，只能让 shell 自己执行一条赋值命令。
 * 该命令自带清屏，执行完屏幕上不会留下这串赋值语句。
 *
 * 命令语法按 PTY 实际运行的 shell 决定（terminal_create 回传的路径），
 * 不看 session.shellType——那个值可能是 'default' 这类占位符。
 *
 * 仅影响已运行的会话——开关状态由调用方写入 session.proxyEnabled，
 * 之后新建或重启的终端走 acquireTerminal 的 spawn 注入路径。
 *
 * @param sessionId 目标会话 ID
 * @param enabled 期望的代理状态
 * @returns 是否实际下发了命令
 */
export function applyProxyToRunning(
  sessionId: string,
  enabled: boolean
): boolean {
  const managed = cache.get(sessionId);
  // PTY 尚未就绪（shellPath 还不知道）时不下发，等下次创建时通过 env 注入
  if (!managed?.terminalId || !managed.shellPath || !managed.isAlive) {
    return false;
  }

  const { settings } = useSettingsStore.getState();
  const command = buildProxySwitchCommand(managed.shellPath, enabled, settings);
  // 开启但未配置代理地址 → 无命令可发
  if (command === null) return false;

  terminalWrite(
    managed.terminalId,
    new TextEncoder().encode(command + "\r")
  ).catch(console.error);
  return true;
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

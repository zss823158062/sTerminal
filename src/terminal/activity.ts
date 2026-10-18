/**
 * 后台活动检测
 *
 * 两个职责：
 * 1. 用户不在看的会话有新输出 / 进程退出 → 打上未读标记（TabBar 显示圆点）
 * 2. "一轮持续输出结束"时闪烁任务栏（Windows）或弹跳 Dock 图标（macOS）
 *
 * 判断"结束"有两条路径：
 * - 首选 OSC 133（shell 集成注入，见 shell/integration.rs）：命令结束时会发
 *   `D;<exit_code>` 标记，判定精确，且不受"程序在等输入但屏幕静止"干扰。
 * - 没有集成时回退到静止超时：要求一轮繁忙至少持续 MIN_BUSY_MS，短命令、
 *   提示符刷新这类会立即结束的交互不会触发窗口提醒。
 */

import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";
import { useLayoutStore } from "../store/layoutStore";
import { useActivityStore } from "../store/activityStore";
import { collectLeaves } from "../utils/layoutTree";

/** 静默多久算一轮输出结束 */
const SETTLE_MS = 1500;
/** 一轮繁忙至少持续多久才值得提醒（过滤短命令；ping 默认 4 包约 3 秒，留余量） */
const MIN_BUSY_MS = 2000;
/** 有 OSC 133 时的最短命令时长：ls/cd 这类不提醒 */
const COMMAND_MIN_MS = 1000;
/** 窗口提醒的全局最小间隔，避免多面板同时结束时反复闪烁 */
const ATTENTION_INTERVAL_MS = 10_000;

interface BusyState {
  /** 本轮繁忙开始时间 */
  startedAt: number;
  /** 最后一次收到输出的时间 */
  lastAt: number;
  /** 静止检测定时器 */
  timer: ReturnType<typeof setTimeout>;
}

/** sessionId → 当前繁忙状态（非响应式，仅用于时序判断） */
const busy = new Map<string, BusyState>();

/** 已确认有 OSC 133 集的会话：结束后由 D 标记负责提醒，静止超时不再重复触发 */
const integrated = new Set<string>();

/** 窗口是否在前台 */
let windowFocused = document.hasFocus();

/** 当前正在显示的会话：每个叶子节点的 activeTabId */
let activeSessions = new Set<string>();

/** 上次请求窗口提醒的时间 */
let lastAttentionAt = 0;

function refreshActiveSessions() {
  const next = new Set<string>();
  for (const leaf of collectLeaves(useLayoutStore.getState().layoutTree)) {
    next.add(leaf.activeTabId);
  }
  activeSessions = next;
}

/** 用户此刻是否看着这个会话 */
function isWatching(sessionId: string): boolean {
  return windowFocused && activeSessions.has(sessionId);
}

/** 闪烁任务栏 / 弹跳 Dock；受全局间隔限制。有退出码且非 0 时用更强的提醒 */
function requestAttention(exitCode?: number) {
  if (windowFocused) return;
  const now = Date.now();
  if (now - lastAttentionAt < ATTENTION_INTERVAL_MS) return;
  lastAttentionAt = now;
  const type =
    exitCode !== undefined && exitCode !== 0
      ? UserAttentionType.Critical
      : UserAttentionType.Informational;
  getCurrentWindow()
    .requestUserAttention(type)
    .catch((err) => {
      // 最常见的原因是 capabilities/default.json 缺少
      // core:window:allow-request-user-attention（core:default 不包含它）
      console.warn("[activity] requestUserAttention failed:", err);
    });
}

/** 停止正在进行的提醒 */
function cancelAttention() {
  getCurrentWindow()
    .requestUserAttention(null)
    .catch(() => {});
}

/** 一轮繁忙结束后的结算 */
function settle(sessionId: string, state: BusyState) {
  const now = Date.now();
  const idle = now - state.lastAt;
  if (idle < SETTLE_MS) {
    // 期间又来了输出，说明还没结束，顺延
    state.timer = setTimeout(() => settle(sessionId, state), SETTLE_MS - idle);
    return;
  }

  busy.delete(sessionId);
  // 有 shell 集成时不在这里提醒：命令真正结束会发 D 标记，由它统一处理，
  // 避免"TUI 静止 1.5 秒"被误判成结束。
  if (integrated.has(sessionId)) return;
  if (state.lastAt - state.startedAt >= MIN_BUSY_MS && !isWatching(sessionId)) {
    requestAttention();
  }
}

/**
 * 收到一个终端输出块。
 * 高频调用：路径上只做 Map 查找和布尔判断，不触发 React 状态更新，
 * 除非该会话确实需要从未读变为已标记。
 */
export function noteOutput(sessionId: string) {
  if (!isWatching(sessionId)) {
    useActivityStore.getState().markUnread(sessionId);
  }

  const now = Date.now();
  const state = busy.get(sessionId);
  if (state) {
    state.lastAt = now;
    return;
  }

  const next: BusyState = {
    startedAt: now,
    lastAt: now,
    timer: setTimeout(() => settle(sessionId, next), SETTLE_MS),
  };
  busy.set(sessionId, next);
}

/**
 * 收到 OSC 133 `D;<exit_code>`：命令执行结束。
 *
 * 这是最可靠的完成信号：无论命令有没有输出、输出是否静止，只有 shell 真正
 * 回到提示符时才会发。首次收到即认定该会话有 shell 集成。
 */
export function noteCommandDone(sessionId: string, exitCode: number) {
  integrated.add(sessionId);

  const state = busy.get(sessionId);
  if (!state) {
    // 本轮没有任何输出（如 cd、export），不值得提醒
    return;
  }
  clearTimeout(state.timer);
  busy.delete(sessionId);

  const duration = state.lastAt - state.startedAt;
  if (duration < COMMAND_MIN_MS || isWatching(sessionId)) return;
  useActivityStore.getState().markUnread(sessionId);
  requestAttention(exitCode);
}

/**
 * 终端进程退出。这是比"输出停止"更明确的完成信号，不受最短时长限制。
 */
export function noteTerminalExit(sessionId: string) {
  const state = busy.get(sessionId);
  if (state) {
    clearTimeout(state.timer);
    busy.delete(sessionId);
  }
  if (isWatching(sessionId)) return;
  useActivityStore.getState().markUnread(sessionId);
  requestAttention();
}

/** 终端销毁时清理定时器和残留标记（sessionId 可能被重新使用） */
export function forgetSession(sessionId: string) {
  const state = busy.get(sessionId);
  if (state) {
    clearTimeout(state.timer);
    busy.delete(sessionId);
  }
  useActivityStore.getState().clearUnread(sessionId);
  integrated.delete(sessionId);
}

/**
 * 安装全局监听（App 挂载时调用一次）。
 *
 * - 焦点/可见性变化：更新 windowFocused；重新可见时清掉当前会话的未读标记，
 *   并撤销任务栏闪烁
 * - 布局变化：更新 activeSessions
 *
 * @returns 卸载函数
 */
export function installActivityTracking(): () => void {
  refreshActiveSessions();

  const onFocus = () => {
    windowFocused = true;
    cancelAttention();
    for (const sessionId of activeSessions) {
      useActivityStore.getState().clearUnread(sessionId);
    }
  };
  const onBlur = () => {
    windowFocused = false;
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") onFocus();
    else windowFocused = false;
  };

  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  const unsubLayout = useLayoutStore.subscribe((state, prev) => {
    if (state.layoutTree !== prev.layoutTree) refreshActiveSessions();
  });

  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibility);
    unsubLayout();
    for (const state of busy.values()) clearTimeout(state.timer);
    busy.clear();
  };
}

import { create } from "zustand";

/**
 * 后台活动标记
 *
 * 只记录"用户不在看、但产生了新输出或进程退出"的会话。
 * 标记是粘性的：切到该 tab 时清掉，而不是输出一停就自动消失。
 *
 * key 是 TerminalSession.id（与 panelId 一致）。
 */
interface ActivityState {
  /** 有新输出的会话 ID 集合 */
  unread: ReadonlySet<string>;
}

interface ActivityActions {
  /** 标记会话有新内容；已标记时不触发更新（输出是高频路径） */
  markUnread: (sessionId: string) => void;
  /** 清除会话标记 */
  clearUnread: (sessionId: string) => void;
}

export type ActivityStore = ActivityState & ActivityActions;

export const useActivityStore = create<ActivityStore>((set) => ({
  unread: new Set(),

  markUnread(sessionId) {
    set((state) => {
      // 已标记：返回原引用，避免每个输出块都触发一次订阅者渲染
      if (state.unread.has(sessionId)) return state;
      const next = new Set(state.unread);
      next.add(sessionId);
      return { unread: next };
    });
  },

  clearUnread(sessionId) {
    set((state) => {
      if (!state.unread.has(sessionId)) return state;
      const next = new Set(state.unread);
      next.delete(sessionId);
      return { unread: next };
    });
  },
}));

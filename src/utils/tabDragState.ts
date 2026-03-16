/**
 * Tab 拖拽状态单例
 *
 * dataTransfer.getData() 在 dragover 事件中被浏览器安全限制禁止访问，
 * 需要一个模块级变量在拖拽期间同步共享源面板信息。
 * 配合 useSyncExternalStore 订阅。
 */

export interface TabDragPayload {
  leafId: string;
  tabId: string;
  tabIndex: number;
}

let payload: TabDragPayload | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function startDrag(p: TabDragPayload) {
  payload = p;
  emit();
}

export function endDrag() {
  payload = null;
  emit();
}

export function getDragPayload() {
  return payload;
}

/** useSyncExternalStore subscribe */
export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** useSyncExternalStore getSnapshot */
export function getSnapshot() {
  return payload;
}

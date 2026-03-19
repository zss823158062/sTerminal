import { create } from "zustand";
import type { AppSettings } from "../types/layout";
import { settingsGet, settingsSave } from "../ipc/layoutApi";

interface SettingsState {
  /** 当前应用设置 */
  settings: AppSettings;
  /** 是否已从后端加载完成 */
  loaded: boolean;
}

interface SettingsActions {
  /** 从后端加载设置 */
  loadSettings: () => Promise<void>;
  /** 更新并持久化设置 */
  updateSettings: (settings: AppSettings) => Promise<void>;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: {
    defaultShell: "",
    defaultShellPath: "",
    defaultWorkingDirectory: "",
    commandGroups: [],
  },
  loaded: false,

  async loadSettings() {
    try {
      const settings = await settingsGet();
      set({ settings, loaded: true });
    } catch (e) {
      console.error("Failed to load settings:", e);
      set({ loaded: true });
    }
  },

  async updateSettings(settings) {
    await settingsSave(settings);
    set({ settings });
  },
}));

/** 设置加载 Promise，供需要等待设置就绪的模块使用 */
export const settingsReady: Promise<void> = useSettingsStore.getState().loadSettings();

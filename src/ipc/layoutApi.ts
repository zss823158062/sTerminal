import { invoke } from "@tauri-apps/api/core";
import type { LayoutNode, SavedLayout, SavedLayoutMeta, AppSettings } from "../types/layout";

/**
 * 保存当前布局为命名布局记录
 *
 * @param name 布局名称，1-50 字符，不允许为空
 * @param tree 完整布局树
 * @returns 新建布局的 UUID
 */
export async function layoutSave(
  name: string,
  tree: LayoutNode
): Promise<string> {
  return invoke("layout_save", { name, tree });
}

/**
 * 获取所有已保存的布局列表（不含树结构，减少传输量）
 *
 * @returns 按 updatedAt 降序排列的布局元数据列表
 */
export async function layoutList(): Promise<SavedLayoutMeta[]> {
  return invoke("layout_list");
}

/**
 * 加载指定 ID 的完整布局数据
 *
 * @param layoutId 要加载的布局 UUID
 * @returns 完整布局记录（含树结构）
 */
export async function layoutLoad(layoutId: string): Promise<SavedLayout> {
  return invoke("layout_load", { layoutId });
}

/**
 * 覆盖更新指定 ID 的布局树
 *
 * @param layoutId 要更新的布局 UUID
 * @param tree 新的布局树
 */
export async function layoutUpdate(
  layoutId: string,
  tree: LayoutNode
): Promise<void> {
  return invoke("layout_update", { layoutId, tree });
}

/**
 * 删除指定 ID 的布局记录（幂等：ID 不存在也返回成功）
 *
 * @param layoutId 要删除的布局 UUID
 */
export async function layoutDelete(layoutId: string): Promise<void> {
  return invoke("layout_delete", { layoutId });
}

/**
 * 重命名指定 ID 的布局
 *
 * @param layoutId 要重命名的布局 UUID
 * @param newName 新名称，1-50 字符
 */
export async function layoutRename(
  layoutId: string,
  newName: string
): Promise<void> {
  return invoke("layout_rename", { layoutId, newName });
}

/**
 * 读取应用设置
 *
 * @returns 当前应用设置
 */
export async function settingsGet(): Promise<AppSettings> {
  return invoke("settings_get");
}

/**
 * 持久化保存应用设置
 *
 * @param settings 要保存的设置对象
 */
export async function settingsSave(settings: AppSettings): Promise<void> {
  return invoke("settings_save", { settings });
}

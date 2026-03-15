use tauri::AppHandle;

use crate::store::layout_store::{AppSettings, LayoutStore, SavedLayout, SavedLayoutMeta};

/// 保存当前布局为命名布局记录
///
/// # 参数
/// - `name`: 布局名称，1-50 个字符，不允许为空
/// - `tree`: 序列化的布局树 JSON 值（对应前端 LayoutNode 结构）
///
/// # 返回
/// - `Ok(String)`: 新建布局的 UUID
/// - `Err(String)`: 名称为空、超过 50 个布局上限、序列化失败等
#[tauri::command]
pub async fn layout_save(
    name: String,
    tree: serde_json::Value,
    app: AppHandle,
) -> Result<String, String> {
    let store = LayoutStore::new(&app)?;
    store.save_layout(name, tree).await
}

/// 获取所有已保存的布局列表（不含树结构，减少传输量）
///
/// # 返回
/// - `Ok(Vec<SavedLayoutMeta>)`: 按 updatedAt 降序排列的布局元数据列表
/// - `Err(String)`: 存储读取失败
#[tauri::command]
pub async fn layout_list(app: AppHandle) -> Result<Vec<SavedLayoutMeta>, String> {
    let store = LayoutStore::new(&app)?;
    store.list_layouts().await
}

/// 加载指定 ID 的完整布局数据
///
/// # 参数
/// - `layout_id`: 要加载的布局 UUID
///
/// # 返回
/// - `Ok(SavedLayout)`: 完整布局记录（含树结构）
/// - `Err(String)`: ID 不存在或存储读取失败
#[tauri::command]
pub async fn layout_load(
    layout_id: String,
    app: AppHandle,
) -> Result<SavedLayout, String> {
    let store = LayoutStore::new(&app)?;
    store.load_layout(&layout_id).await
}

/// 删除指定 ID 的布局记录（幂等：ID 不存在也返回 Ok）
///
/// # 参数
/// - `layout_id`: 要删除的布局 UUID
///
/// # 返回
/// - `Ok(())`: 删除成功
/// - `Err(String)`: 存储写入失败
#[tauri::command]
pub async fn layout_delete(
    layout_id: String,
    app: AppHandle,
) -> Result<(), String> {
    let store = LayoutStore::new(&app)?;
    store.delete_layout(&layout_id).await
}

/// 重命名指定 ID 的布局
///
/// # 参数
/// - `layout_id`: 要重命名的布局 UUID
/// - `new_name`: 新名称，1-50 个字符
///
/// # 返回
/// - `Ok(())`: 重命名成功
/// - `Err(String)`: ID 不存在、名称不合法或存储写入失败
#[tauri::command]
pub async fn layout_rename(
    layout_id: String,
    new_name: String,
    app: AppHandle,
) -> Result<(), String> {
    let store = LayoutStore::new(&app)?;
    store.rename_layout(&layout_id, new_name).await
}

/// 读取应用设置
///
/// # 返回
/// - `Ok(AppSettings)`: 当前应用设置
/// - `Err(String)`: 读取失败
#[tauri::command]
pub async fn settings_get(app: AppHandle) -> Result<AppSettings, String> {
    let store = LayoutStore::new(&app)?;
    store.get_settings().await
}

/// 持久化保存应用设置
///
/// # 参数
/// - `settings`: 要保存的设置对象
///
/// # 返回
/// - `Ok(())`: 保存成功
/// - `Err(String)`: 写入失败
#[tauri::command]
pub async fn settings_save(
    settings: AppSettings,
    app: AppHandle,
) -> Result<(), String> {
    let store = LayoutStore::new(&app)?;
    store.save_settings(settings).await
}

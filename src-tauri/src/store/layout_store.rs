use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// config.json 在 tauri-plugin-store 中的存储键
const STORE_FILE: &str = "config.json";
const LAYOUTS_KEY: &str = "layouts";
const SETTINGS_KEY: &str = "settings";

/// 最大布局保存数量
const MAX_LAYOUTS: usize = 50;

// ============================================================
// 类型定义（对应前端 TypeScript 类型）
// ============================================================

/// 完整布局记录，对应前端 SavedLayout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedLayout {
    /// 布局唯一 ID，UUID v4
    pub id: String,
    /// 用户命名的布局名称，1-50 字符
    pub name: String,
    /// 创建时间，ISO 8601 格式字符串
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// 最后更新时间，ISO 8601 格式字符串
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// 布局树的 JSON 值（对应前端 LayoutNode）
    pub tree: Value,
    /// 布局包含的终端面板数量
    #[serde(rename = "panelCount")]
    pub panel_count: u32,
}

/// 布局列表元数据（不含树结构），对应前端 SavedLayoutMeta
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedLayoutMeta {
    /// 布局唯一 ID
    pub id: String,
    /// 布局名称
    pub name: String,
    /// 创建时间，ISO 8601 格式
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// 更新时间，ISO 8601 格式
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// 布局包含的终端面板数量
    #[serde(rename = "panelCount")]
    pub panel_count: u32,
}

/// 应用设置，对应前端 AppSettings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// 默认 Shell 类型标识符
    #[serde(rename = "defaultShell")]
    pub default_shell: String,
    /// 默认初始工作目录，空字符串使用 Home 目录
    #[serde(rename = "defaultWorkingDirectory")]
    pub default_working_directory: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            default_shell: "powershell".to_string(),
            default_working_directory: String::new(),
        }
    }
}

// ============================================================
// LayoutStore 封装
// ============================================================

/// tauri-plugin-store 读写封装
///
/// 所有操作都通过 StoreExt 读写 config.json，
/// 只操作磁盘，不管理运行时状态。
pub struct LayoutStore {
    app: AppHandle,
}

impl LayoutStore {
    /// 创建 LayoutStore 实例
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        Ok(LayoutStore { app: app.clone() })
    }

    // ----------------------------------------------------------
    // 内部辅助方法
    // ----------------------------------------------------------

    /// 读取所有布局
    fn read_layouts(&self) -> Result<Vec<SavedLayout>, String> {
        let store = self
            .app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;
        match store.get(LAYOUTS_KEY) {
            Some(v) => serde_json::from_value(v).map_err(|e| format!("Failed to parse layouts: {}", e)),
            None => Ok(Vec::new()),
        }
    }

    /// 写入所有布局
    fn write_layouts(&self, layouts: &[SavedLayout]) -> Result<(), String> {
        let store = self
            .app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;
        let value = serde_json::to_value(layouts).map_err(|e| format!("Serialization error: {}", e))?;
        store.set(LAYOUTS_KEY, value);
        store.save().map_err(|e| format!("Failed to save store: {}", e))?;
        Ok(())
    }

    /// 获取当前 ISO 8601 时间戳
    fn now_iso8601() -> String {
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    }

    /// 计算布局树中叶子节点数量
    fn count_leaves(tree: &Value) -> u32 {
        match tree.get("type").and_then(|t| t.as_str()) {
            Some("terminal") => 1,
            Some("split") => {
                let first = tree.get("first").map(Self::count_leaves).unwrap_or(0);
                let second = tree.get("second").map(Self::count_leaves).unwrap_or(0);
                first + second
            }
            _ => 0,
        }
    }

    // ----------------------------------------------------------
    // 公开 CRUD 方法
    // ----------------------------------------------------------

    /// 保存新布局
    ///
    /// - 验证名称非空且 ≤ 50 字符
    /// - 验证已保存布局数量 < MAX_LAYOUTS
    /// - 生成 UUID，记录时间戳，追加到列表
    pub async fn save_layout(&self, name: String, tree: Value) -> Result<String, String> {
        // 验证名称
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err("布局名称不能为空".to_string());
        }
        if name.chars().count() > 50 {
            return Err("布局名称不能超过 50 个字符".to_string());
        }

        let mut layouts = self.read_layouts()?;

        // 验证数量上限
        if layouts.len() >= MAX_LAYOUTS {
            return Err(format!(
                "已达到最大保存数量 {}，请先删除部分布局",
                MAX_LAYOUTS
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Self::now_iso8601();
        let panel_count = Self::count_leaves(&tree);

        layouts.push(SavedLayout {
            id: id.clone(),
            name,
            created_at: now.clone(),
            updated_at: now,
            tree,
            panel_count,
        });

        self.write_layouts(&layouts)?;
        Ok(id)
    }

    /// 获取布局元数据列表（按 updatedAt 降序）
    pub async fn list_layouts(&self) -> Result<Vec<SavedLayoutMeta>, String> {
        let mut layouts = self.read_layouts()?;
        // 按 updatedAt 降序排序
        layouts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(layouts
            .into_iter()
            .map(|l| SavedLayoutMeta {
                id: l.id,
                name: l.name,
                created_at: l.created_at,
                updated_at: l.updated_at,
                panel_count: l.panel_count,
            })
            .collect())
    }

    /// 加载指定 ID 的完整布局
    pub async fn load_layout(&self, layout_id: &str) -> Result<SavedLayout, String> {
        let layouts = self.read_layouts()?;
        layouts
            .into_iter()
            .find(|l| l.id == layout_id)
            .ok_or_else(|| format!("Layout '{}' not found", layout_id))
    }

    /// 删除指定 ID 的布局（幂等）
    pub async fn delete_layout(&self, layout_id: &str) -> Result<(), String> {
        let mut layouts = self.read_layouts()?;
        layouts.retain(|l| l.id != layout_id);
        self.write_layouts(&layouts)
    }

    /// 覆盖更新指定 ID 的布局树
    pub async fn update_layout(&self, layout_id: &str, tree: Value) -> Result<(), String> {
        let mut layouts = self.read_layouts()?;
        let layout = layouts
            .iter_mut()
            .find(|l| l.id == layout_id)
            .ok_or_else(|| format!("Layout '{}' not found", layout_id))?;
        layout.tree = tree.clone();
        layout.panel_count = Self::count_leaves(&tree);
        layout.updated_at = Self::now_iso8601();
        self.write_layouts(&layouts)
    }

    /// 重命名指定 ID 的布局
    pub async fn rename_layout(&self, layout_id: &str, new_name: String) -> Result<(), String> {
        let new_name = new_name.trim().to_string();
        if new_name.is_empty() {
            return Err("布局名称不能为空".to_string());
        }
        if new_name.chars().count() > 50 {
            return Err("布局名称不能超过 50 个字符".to_string());
        }

        let mut layouts = self.read_layouts()?;
        let layout = layouts
            .iter_mut()
            .find(|l| l.id == layout_id)
            .ok_or_else(|| format!("Layout '{}' not found", layout_id))?;

        layout.name = new_name;
        layout.updated_at = Self::now_iso8601();
        self.write_layouts(&layouts)
    }

    /// 读取应用设置（不存在时返回默认值）
    pub async fn get_settings(&self) -> Result<AppSettings, String> {
        let store = self
            .app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;
        match store.get(SETTINGS_KEY) {
            Some(v) => serde_json::from_value(v)
                .map_err(|e| format!("Failed to parse settings: {}", e)),
            None => Ok(AppSettings::default()),
        }
    }

    /// 保存应用设置
    pub async fn save_settings(&self, settings: AppSettings) -> Result<(), String> {
        let store = self
            .app
            .store(STORE_FILE)
            .map_err(|e| format!("Failed to open store: {}", e))?;
        let value = serde_json::to_value(&settings)
            .map_err(|e| format!("Serialization error: {}", e))?;
        store.set(SETTINGS_KEY, value);
        store.save().map_err(|e| format!("Failed to save store: {}", e))?;
        Ok(())
    }
}

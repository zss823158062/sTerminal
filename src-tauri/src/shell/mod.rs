/// Shell 可执行路径探测（DEV-B 实现）
pub mod detector;
/// OSC 133 shell 集成注入
pub mod integration;
/// 管理员权限：提权检测、sudo 内联模式探测、以管理员身份重启
pub mod elevation;

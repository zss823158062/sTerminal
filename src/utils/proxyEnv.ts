/**
 * 代理环境变量构建
 *
 * 代理地址是全局设置（AppSettings.proxyUrl），开关是每个控制台独立的
 * （TerminalSession.proxyEnabled）。两者结合决定单个 PTY 拿到哪些环境变量。
 *
 * 环境变量只能在进程 spawn 时注入，因此这里同时提供两条路径：
 * - buildProxyEnv：新建/重启终端时注入到 PTY
 * - buildProxySwitchCommand：运行中的 shell 切换开关时写入的命令，让当前会话立即生效
 */

/** NO_PROXY 未配置时的默认排除列表：本地回环不该走代理 */
export const DEFAULT_NO_PROXY = "localhost,127.0.0.1,::1";

/** 受管理的代理变量基名（实际注入时大小写各一份） */
const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] as const;

/** 所有受管理的环境变量名（大写 + 小写） */
export const PROXY_ENV_KEYS: string[] = PROXY_KEYS.flatMap((k) => [
  k,
  k.toLowerCase(),
]);

export interface ProxyConfig {
  /** 代理地址，如 http://127.0.0.1:7890；空表示未配置 */
  proxyUrl?: string;
  /** 不走代理的主机列表，逗号分隔；空表示使用 DEFAULT_NO_PROXY */
  noProxy?: string;
}

/**
 * 代理地址是否可用。
 * 只做非空校验——协议前缀交给 normalizeProxyUrl 补全。
 */
export function hasProxyUrl(config: ProxyConfig): boolean {
  return !!config.proxyUrl?.trim();
}

/**
 * 规范化代理地址：缺少协议前缀时补 http://
 * 例如 "127.0.0.1:7890" → "http://127.0.0.1:7890"
 */
export function normalizeProxyUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
}

/**
 * 构建注入 PTY 的代理环境变量。
 *
 * 同时写入大写和小写两种形式：Node/Go/Python 惯用大写，curl 只认小写，
 * Windows 环境变量名不区分大小写会自动合并，多写一份无副作用。
 *
 * @returns 代理地址为空时返回空对象（调用方无需额外判断）
 */
export function buildProxyEnv(config: ProxyConfig): Record<string, string> {
  const url = normalizeProxyUrl(config.proxyUrl ?? "");
  if (!url) return {};

  const noProxy = config.noProxy?.trim() || DEFAULT_NO_PROXY;
  const values: Record<string, string> = {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    ALL_PROXY: url,
    NO_PROXY: noProxy,
  };

  const env: Record<string, string> = {};
  for (const key of PROXY_KEYS) {
    env[key] = values[key];
    env[key.toLowerCase()] = values[key];
  }
  return env;
}

/** shell 语法族 */
type ShellFamily = "posix" | "fish" | "powershell" | "cmd";

/**
 * 从 shell 可执行文件路径判断语法族。
 *
 * 必须用实际 spawn 的那个可执行文件路径（terminal_create 的返回值），
 * 不要用 TerminalSession.shellType——后者可能是 'default' 这类占位值，
 * 或与 PTY 里真正运行的 shell 不一致。
 *
 * 未知的 shell 按 posix 处理：sh/bash/zsh/dash/ash 等占绝大多数。
 */
export function shellFamilyFromPath(shellPath: string): ShellFamily {
  // 取 basename 并去掉扩展名，兼容 Windows 反斜杠
  const base = shellPath
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|com|cmd|bat)$/, "");

  if (base === "cmd") return "cmd";
  if (base === "powershell" || base === "pwsh") return "powershell";
  if (base === "fish") return "fish";
  return "posix";
}

/**
 * 该语法族的环境变量名是否区分大小写。
 *
 * 按 shell 而非按平台判断：Windows 上的 git-bash 跑在 MSYS2 环境里，
 * 自己维护一份区分大小写的环境表，仍需要大小写两份。
 */
function isCaseSensitive(family: ShellFamily): boolean {
  return family === "posix" || family === "fish";
}

/** POSIX 单引号转义：'\'' 收尾再重开 */
function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** PowerShell 单引号转义：内部单引号翻倍 */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * 生成让运行中的 shell 立即启用/关闭代理的命令。
 *
 * 环境变量无法从外部注入到已启动的进程，只能让 shell 自己执行赋值。
 * 赋值语句会被 shell 回显到屏幕上，所以命令末尾接一条清屏——执行完屏幕
 * 是干净的，用户看不到这一长串 set/export。代价是同时清掉了之前的输出。
 *
 * @param shellPath 实际运行的 shell 可执行文件路径，决定命令语法
 * @param enabled true 设置代理变量，false 清除
 * @returns 可直接写入 PTY 的单行命令；无需操作时返回 null
 */
export function buildProxySwitchCommand(
  shellPath: string,
  enabled: boolean,
  config: ProxyConfig
): string | null {
  const env = buildProxyEnv(config);
  // 开启但没配地址 → 无事可做
  if (enabled && Object.keys(env).length === 0) return null;

  const family = shellFamilyFromPath(shellPath);

  // 大小写不敏感的 shell（cmd / PowerShell）里小写副本是同一个变量，
  // 重复赋值只会让回显变长，因此只发大写形式。
  const keys: string[] = isCaseSensitive(family)
    ? PROXY_ENV_KEYS
    : [...PROXY_KEYS];

  // body：赋值/清除语句；clear：清屏后缀
  // 用 && 串清屏的地方，语义是"赋值成功才清屏"，失败时错误信息留在屏幕上。
  let body: string;
  let clear: string;

  switch (family) {
    case "cmd":
      // 必须用 set "K=V"：裸写 `set K=V && ...` 会把 && 前的空格存进变量，
      // 清除时变量值成了 " "（claude 等工具会报无效代理 URL）。
      // 引号内的 & | < > 也不再被 cmd 解析，无需转义。
      body = keys
        .map((k) => `set "${k}=${enabled ? env[k] : ""}"`)
        .join(" && ");
      clear = " && cls";
      break;

    case "powershell":
      // $env:X=$null 即删除该变量。
      // PowerShell 5.1 不支持 && 链式操作符，只能用 ; 分隔
      body = keys
        .map((k) =>
          enabled ? `$env:${k}=${psQuote(env[k])}` : `$env:${k}=$null`
        )
        .join("; ");
      clear = "; Clear-Host";
      break;

    case "fish":
      body = enabled
        ? keys.map((k) => `set -gx ${k} ${posixQuote(env[k])}`).join("; ")
        : `set -e ${keys.join(" ")}`;
      clear = "; clear";
      break;

    case "posix":
    default:
      body = enabled
        ? `export ${keys.map((k) => `${k}=${posixQuote(env[k])}`).join(" ")}`
        : `unset ${keys.join(" ")}`;
      clear = " && clear";
      break;
  }

  return body + clear;
}

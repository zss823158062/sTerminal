import { getVersion } from "@tauri-apps/api/app";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
}

/** semver 版本比较：a < b 返回 -1，a == b 返回 0，a > b 返回 1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/** 检查 GitHub Release 是否有新版本，返回 null 表示无更新或失败 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const currentVersion = await getVersion();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await fetch(
      "https://api.github.com/repos/zss823158062/sTerminal/releases/latest",
      {
        signal: controller.signal,
        headers: { Accept: "application/vnd.github.v3+json" },
      }
    );
    if (!resp.ok) return null;

    const data = await resp.json();
    const latestVersion: string = data.tag_name ?? "";
    if (!latestVersion) return null;

    if (compareVersions(currentVersion, latestVersion) >= 0) return null;

    return {
      currentVersion,
      latestVersion: latestVersion.replace(/^v/, ""),
      releaseUrl: data.html_url ?? `https://github.com/zss823158062/sTerminal/releases/latest`,
      releaseNotes: data.body ?? "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

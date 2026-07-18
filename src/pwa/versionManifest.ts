export const APP_VERSION_MANIFEST_PATH = "/app-version.json";

const MAX_VERSION_LENGTH = 64;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface AppVersionManifest {
  version: string;
}

export function parseAppVersionManifest(value: unknown): AppVersionManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("version" in record)) return null;
  if (typeof record.version !== "string") return null;
  const version = record.version.trim();
  if (
    version.length === 0 ||
    version.length > MAX_VERSION_LENGTH ||
    !VERSION_PATTERN.test(version)
  ) {
    return null;
  }
  return { version };
}

export function serializeAppVersionManifest(version: string): string {
  const manifest = parseAppVersionManifest({ version });
  if (!manifest) throw new Error(`無效的 App 版本：${version}`);
  return `${JSON.stringify(manifest)}\n`;
}

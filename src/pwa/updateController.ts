import { APP_VERSION } from "../version";
import {
  APP_VERSION_MANIFEST_PATH,
  parseAppVersionManifest,
} from "./versionManifest";

export type PwaUpdatePhase = "idle" | "ready" | "applying" | "error";

export interface PwaUpdateSnapshot {
  phase: PwaUpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  error: string | null;
}

export type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;
export type AvailableVersionLoader = () => Promise<string | null>;
export type VersionFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

const UPDATE_ERROR_MESSAGE = "更新尚未完成，請稍後再試。";

export async function fetchAvailableAppVersion(
  fetcher: VersionFetcher = fetch,
  now: () => number = Date.now,
): Promise<string | null> {
  try {
    const response = await fetcher(
      `${APP_VERSION_MANIFEST_PATH}?update=${now()}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
      },
    );
    if (!response.ok) return null;
    return parseAppVersionManifest(await response.json())?.version ?? null;
  } catch {
    return null;
  }
}

export class PwaUpdateController {
  private snapshot: PwaUpdateSnapshot;
  private readonly listeners = new Set<() => void>();
  private updateServiceWorker: UpdateServiceWorker | null = null;
  private applyPromise: Promise<void> | null = null;
  private announcementId = 0;

  constructor(currentVersion = APP_VERSION) {
    this.snapshot = {
      phase: "idle",
      currentVersion,
      availableVersion: null,
      error: null,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): PwaUpdateSnapshot => this.snapshot;

  setUpdateServiceWorker(updateServiceWorker: UpdateServiceWorker): void {
    this.updateServiceWorker = updateServiceWorker;
  }

  async announceUpdate(
    loadVersion: AvailableVersionLoader = fetchAvailableAppVersion,
  ): Promise<void> {
    const announcementId = ++this.announcementId;
    this.setSnapshot({
      phase: "ready",
      currentVersion: this.snapshot.currentVersion,
      availableVersion: null,
      error: null,
    });

    const availableVersion = await loadVersion().catch(() => null);
    if (announcementId !== this.announcementId || this.snapshot.phase === "idle") return;
    this.setSnapshot({ ...this.snapshot, availableVersion });
  }

  dismiss(): void {
    if (this.snapshot.phase === "applying") return;
    this.announcementId += 1;
    this.setSnapshot({
      phase: "idle",
      currentVersion: this.snapshot.currentVersion,
      availableVersion: null,
      error: null,
    });
  }

  readonly applyUpdate = (): Promise<void> => {
    if (this.applyPromise) return this.applyPromise;
    if (this.snapshot.phase !== "ready" && this.snapshot.phase !== "error") {
      return Promise.resolve();
    }

    const updateServiceWorker = this.updateServiceWorker;
    if (!updateServiceWorker) {
      const error = new Error("尚未取得 Service Worker 更新控制器");
      this.setSnapshot({ ...this.snapshot, phase: "error", error: UPDATE_ERROR_MESSAGE });
      return Promise.reject(error);
    }

    this.setSnapshot({ ...this.snapshot, phase: "applying", error: null });
    const operation = Promise.resolve()
      .then(() => updateServiceWorker(true))
      .then(() => undefined)
      .catch((error: unknown) => {
        this.setSnapshot({ ...this.snapshot, phase: "error", error: UPDATE_ERROR_MESSAGE });
        throw error;
      })
      .finally(() => {
        this.applyPromise = null;
      });
    this.applyPromise = operation;
    return operation;
  };

  private setSnapshot(next: PwaUpdateSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}

export const pwaUpdateController = new PwaUpdateController();

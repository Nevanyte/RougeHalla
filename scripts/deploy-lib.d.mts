export interface DeployConfig {
  repository: string;
  branch: string;
  stateDir: string;
  repositoryDir: string;
  releasesDir: string;
  stashFile: string;
  port: number;
  publicUrl: string;
  nodeBinary: string;
  keepReleases: number;
  checkTimeoutMs: number;
  readyTimeoutMs: number;
  verifyTimeoutMs: number;
  legacyRoot?: string;
  environmentFile?: string;
}
export interface DeployOptions {
  command: string;
  config: string;
  json: boolean;
  retry: boolean;
  ref?: string;
  help?: boolean;
}
export const DEFAULT_CONFIG: string;
export function sleep(ms: number): Promise<void>;
export function safeRef(value: unknown): boolean;
export function parseArgs(argv: string[]): DeployOptions;
export function validateConfig(raw: unknown): DeployConfig;
export function productionEnvironment(base: Record<string, string>, overrides: Record<string, string>, config: DeployConfig, releaseDir: string): Record<string, string>;
export function readJson(file: string, fallback?: unknown): Promise<any>;
export function writeJson(file: string, data: unknown): Promise<void>;
export function alive(pid: number): boolean;
export function acquireLock(stateDir: string): Promise<() => Promise<void>>;

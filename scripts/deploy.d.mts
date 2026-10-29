import type { DeployConfig, DeployOptions } from "./deploy-lib.mjs";

export function prepareRelease(config: DeployConfig, ref?: string, report?: (message: string) => void): Promise<any>;
export function switchRelease(config: DeployConfig, current: any, target: any, report?: (message: string) => void): Promise<any>;
export function status(config: DeployConfig): Promise<any>;
export function run(options: DeployOptions, operations?: {
  prepareRelease?: (...args: any[]) => Promise<any>;
  switchRelease?: (...args: any[]) => Promise<any>;
  status?: (...args: any[]) => Promise<any>;
  prune?: (...args: any[]) => Promise<any>;
}): Promise<any>;

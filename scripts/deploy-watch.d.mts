export const LABEL: string;
export function parseWatchArgs(argv: string[]): { command: string; config: string; interval: number };
export function launchAgentPlist(options: { node: string; runtime: string; config: string; stateDir: string; interval: number }): string;
export function runWatch(args: ReturnType<typeof parseWatchArgs>): Promise<number>;

// A stable, single-process entry point; Colyseus owns graceful SIGTERM shutdown.
import { startServer } from "../packages/server/src/index.ts";

try {
  await startServer();
  console.log(`[deploy-server] listening on :${process.env.RAID_PORT}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

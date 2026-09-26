// Entry point for `npm run dashboard`.
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { createDashboardServer } from "./server.js";

const server = createDashboardServer(config.tradeLogFile, config.stateFile);

server.listen(config.dashboardPort, () => {
  logger.info(
    { port: config.dashboardPort, log: config.tradeLogFile },
    `Dashboard running at http://localhost:${config.dashboardPort}`,
  );
});

const shutdown = () => {
  logger.info("Shutting down dashboard...");
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

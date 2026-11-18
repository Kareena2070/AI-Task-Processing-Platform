const path = require("path");
const dotenv = require("dotenv");

// Configure environment variables using dotenv
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = require("./app");
const logger = require("./config/logger");
const { connectDB, disconnectDB } = require("./config/database");
const { connectRedis, disconnectRedis } = require("./config/redis");

const PORT = process.env.PORT || 5000;
const SHUTDOWN_TIMEOUT_MS = 10000;

let server;
let isShuttingDown = false;

async function closeServices() {
    try {
        await disconnectDB();
    } catch (err) {
        logger.error({ error: err.message }, "Error disconnecting MongoDB");
    }

    try {
        await disconnectRedis();
    } catch (err) {
        logger.error({ error: err.message }, "Error disconnecting Redis");
    }
}

async function gracefulShutdown(reason, exitCode = 0) {
    // Shutdown re-entrancy guard
    if (isShuttingDown) {
        logger.warn(`Shutdown already in progress. Ignoring repeated ${reason} trigger.`);
        return;
    }
    isShuttingDown = true;

    logger.info(`Initiating graceful shutdown due to: ${reason} (exitCode: ${exitCode})...`);

    // Forced shutdown timer to prevent hanging indefinitely
    const forceExitTimer = setTimeout(() => {
        logger.error("Graceful shutdown timed out. Forcing process exit.");
        process.exit(exitCode !== 0 ? exitCode : 1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
        // If HTTP server is listening, close it first before tearing down connections
        if (server && server.listening) {
            await new Promise((resolve) => {
                server.close((err) => {
                    if (err) {
                        logger.error({ error: err.message }, "Error while closing HTTP server");
                    } else {
                        logger.info("HTTP server closed successfully");
                    }
                    resolve();
                });
            });
        }

        // Always clean up database and Redis connections
        await closeServices();

        clearTimeout(forceExitTimer);
        logger.info("All connections closed. Exiting process.");
        process.exit(exitCode);
    } catch (err) {
        clearTimeout(forceExitTimer);
        logger.error({ error: err.message }, "Error encountered during graceful shutdown");
        process.exit(exitCode !== 0 ? exitCode : 1);
    }
}

async function startServer() {
    try {
        await connectDB();
        await connectRedis();

        server = app.listen(PORT, () => {
            logger.info(`Server running on http://localhost:${PORT}`);
        });

        server.on("error", async (error) => {
            logger.error({ error: error.message }, "HTTP server error encountered");
            await gracefulShutdown("server_error", 1);
        });
    } catch (error) {
        logger.error({ error: error.message }, "Failed to start server");
        await gracefulShutdown("startup_failure", 1);
    }
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM", 0));
process.on("SIGINT", () => gracefulShutdown("SIGINT", 0));

process.on("unhandledRejection", (reason) => {
    logger.error(
        {
            error: reason instanceof Error ? reason.message : String(reason),
            stack: reason instanceof Error ? reason.stack : undefined,
        },
        "Unhandled Rejection detected"
    );
    gracefulShutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
    logger.error(
        {
            error: error.message,
            stack: error.stack,
        },
        "Uncaught Exception detected"
    );
    gracefulShutdown("uncaughtException", 1);
});

startServer();

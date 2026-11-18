const mongoose = require("mongoose");
const logger = require("./logger");

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 1000;

let isConnecting = false;
let listenersRegistered = false;

function setupConnectionListeners() {
    if (listenersRegistered) {
        return;
    }
    listenersRegistered = true;

    mongoose.connection.on("error", (err) => {
        logger.error({ error: err.message }, "MongoDB connection error occurred");
    });

    mongoose.connection.on("disconnected", () => {
        logger.warn("MongoDB disconnected");
    });
}

async function connectDB(options = {}) {
    const maxRetries = options.maxRetries || MAX_RETRIES;
    const initialDelay = options.initialDelayMs || INITIAL_RETRY_DELAY_MS;

    // If already connected (1 = connected), return existing connection
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    // If connection is in progress, wait for it rather than creating a duplicate
    if (isConnecting || mongoose.connection.readyState === 2) {
        return new Promise((resolve, reject) => {
            mongoose.connection.once("open", () => resolve(mongoose.connection));
            mongoose.connection.once("error", reject);
        });
    }

    const uri = process.env.MONGODB_URI;

    if (!uri) {
        const error = new Error("MONGODB_URI is missing from environment variables");
        logger.error(error.message);
        throw error;
    }

    setupConnectionListeners();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            isConnecting = true;
            await mongoose.connect(uri);
            isConnecting = false;
            logger.info("MongoDB connected successfully via Mongoose!");
            return mongoose.connection;
        } catch (error) {
            isConnecting = false;

            logger.error(
                { attempt, maxRetries, error: error.message },
                `MongoDB connection attempt ${attempt} of ${maxRetries} failed`
            );

            if (attempt < maxRetries) {
                const delayMs = initialDelay * Math.pow(2, attempt - 1);
                logger.info(`Retrying MongoDB connection in ${delayMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            } else {
                logger.error("All MongoDB connection retry attempts exhausted");
                throw error;
            }
        }
    }
}

async function disconnectDB() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        logger.info("MongoDB disconnected successfully");
    }
}

function getDB() {
    if (mongoose.connection.readyState !== 1) {
        throw new Error("Database not connected. Call connectDB first.");
    }
    return mongoose.connection;
}

module.exports = {
    connectDB,
    disconnectDB,
    getDB,
};

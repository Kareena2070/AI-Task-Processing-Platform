const { createClient } = require("redis");
const logger = require("./logger");

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 3) {
                return new Error("Redis connection retries exhausted");
            }
            return Math.min(retries * 200, 1000);
        },
    },
});

redisClient.on("error", (error) => {
    logger.error({ error: error.message }, "Redis Client Error");
});

redisClient.on("reconnecting", () => {
    logger.warn("Redis client reconnecting");
});

async function connectRedis() {
    try {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }

        await redisClient.ping();

        logger.info("Redis connected successfully!");

        return redisClient;
    } catch (error) {
        logger.error({ error: error.message }, "Redis connection failed");
        throw error;
    }
}

async function disconnectRedis() {
    if (redisClient.isOpen) {
        await redisClient.quit();
        logger.info("Redis client disconnected successfully");
    }
}

function getRedisClient() {
    if (!redisClient.isReady) {
        throw new Error("Redis is not connected. Call connectRedis first.");
    }

    return redisClient;
}

module.exports = {
    connectRedis,
    disconnectRedis,
    getRedisClient,
};

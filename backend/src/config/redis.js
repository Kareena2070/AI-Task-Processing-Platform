
const { createClient } = require("redis");

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});

redisClient.on("error", (error) => {
    console.error("Redis Client Error:", error.message);
});

async function connectRedis() {
    try {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }

        await redisClient.ping();

        console.log("Redis connected successfully!");

        return redisClient;
    } catch (error) {
        console.error("Redis connection failed:", error.message);
        throw error;
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
    getRedisClient,
};

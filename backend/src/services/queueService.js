"use strict";

const { getRedisClient } = require("../config/redis");
const logger = require("../config/logger");
const AppError = require("../utils/appError");

const STREAM_NAME = "task_stream";

/**
 * Publishes a task job to Redis Streams for background worker processing.
 *
 * @param {object} params
 * @param {string} params.taskId - MongoDB ObjectId string
 * @param {string} params.operation - Operation name (e.g. uppercase, lowercase)
 * @param {string|object} params.input - Input payload as stored in task record
 * @returns {Promise<string>} The Redis-generated message ID
 */
async function publishTaskJob({ taskId, operation, input }) {
  if (!taskId || typeof taskId !== "string") {
    throw new AppError("Invalid or missing taskId for queue publishing", 500);
  }

  if (!operation || typeof operation !== "string") {
    throw new AppError("Invalid or missing operation for queue publishing", 500);
  }

  if (input === undefined || input === null) {
    throw new AppError("Invalid or missing input for queue publishing", 500);
  }

  // Verify Redis connection via existing client getter
  let client;
  try {
    client = getRedisClient();
  } catch (error) {
    logger.error(
      { error: error.message, taskId },
      "Redis client is not ready for stream publishing"
    );
    throw new AppError("Queue service unavailable: Redis is not connected", 503);
  }

  // Ensure all payload values are strings for Redis Streams compatibility
  const payload = {
    taskId: String(taskId),
    operation: String(operation),
    input: typeof input === "string" ? input : JSON.stringify(input),
    queuedAt: new Date().toISOString(),
  };

  try {
    const messageId = await client.xAdd(STREAM_NAME, "*", payload);

    logger.info(
      {
        messageId,
        taskId: payload.taskId,
        operation: payload.operation,
        stream: STREAM_NAME,
      },
      "Task published to Redis Stream successfully"
    );

    return messageId;
  } catch (error) {
    logger.error(
      {
        error: error.message,
        taskId: payload.taskId,
        stream: STREAM_NAME,
      },
      "Failed to publish task to Redis Stream"
    );
    throw new AppError(`Failed to publish task to queue: ${error.message}`, 500);
  }
}

module.exports = {
  publishTaskJob,
  STREAM_NAME,
};

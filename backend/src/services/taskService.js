"use strict";

const mongoose = require("mongoose");
const Task = require("../models/Task");
const logger = require("../config/logger");
const queueService = require("./queueService");
const AppError = require("../utils/appError");

const MAX_TITLE_LENGTH = 200;
const MAX_OPERATION_LENGTH = 100;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const POSITIVE_INT_REGEX = /^[1-9]\d*$/;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

const PERMITTED_UPDATE_FIELDS = ["title", "input", "operation"];

const PROTECTED_FIELDS = [
  "userId",
  "status",
  "result",
  "error",
  "logs",
  "startedAt",
  "completedAt",
  "createdAt",
  "updatedAt",
  "_id",
  "__v",
];

/**
 * Validates and normalizes pagination query parameters.
 *
 * @param {string|number|undefined} pageParam
 * @param {string|number|undefined} limitParam
 * @returns {{ page: number, limit: number }}
 */
function parsePaginationParams(pageParam, limitParam) {
  let page = DEFAULT_PAGE;
  let limit = DEFAULT_LIMIT;

  if (pageParam !== undefined) {
    const pageStr = String(pageParam).trim();
    if (!POSITIVE_INT_REGEX.test(pageStr)) {
      throw new AppError("Page must be a positive integer greater than 0", 400);
    }
    page = parseInt(pageStr, 10);
  }

  if (limitParam !== undefined) {
    const limitStr = String(limitParam).trim();
    if (!POSITIVE_INT_REGEX.test(limitStr)) {
      throw new AppError("Limit must be a positive integer greater than 0", 400);
    }
    limit = parseInt(limitStr, 10);
    if (limit > MAX_LIMIT) {
      throw new AppError(`Limit cannot exceed ${MAX_LIMIT}`, 400);
    }
  }

  return { page, limit };
}

/**
 * Serializes and sanitizes task document for HTTP response.
 *
 * @param {import("mongoose").Document} task
 * @returns {object}
 */
function formatTaskResponse(task) {
  let formattedInput = task.input;
  if (typeof task.input === "string") {
    try {
      formattedInput = JSON.parse(task.input);
    } catch {
      formattedInput = task.input;
    }
  }

  return {
    id: task._id.toString(),
    title: task.title,
    input: formattedInput,
    operation: task.operation,
    status: task.status,
    createdAt: task.createdAt,
  };
}

/**
 * Creates a new task associated with the authenticated user.
 *
 * @param {object} taskData
 * @param {string|mongoose.Types.ObjectId} taskData.userId
 * @param {string} taskData.title
 * @param {string|object} taskData.input
 * @param {string} taskData.operation
 * @returns {Promise<object>} Sanitized task response object
 */
async function createTask({ userId, title, input, operation }) {
  // 1. Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError("Invalid user identity", 401);
  }

  // 2. Validate title
  if (!title) {
    throw new AppError("Task title is required", 400);
  }

  if (typeof title !== "string") {
    throw new AppError("Task title must be a string", 400);
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    throw new AppError("Task title cannot be empty or whitespace only", 400);
  }

  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    throw new AppError(
      `Task title cannot exceed ${MAX_TITLE_LENGTH} characters`,
      400
    );
  }

  // 3. Validate operation
  if (!operation) {
    throw new AppError("Task operation is required", 400);
  }

  if (typeof operation !== "string") {
    throw new AppError("Task operation must be a string", 400);
  }

  const trimmedOperation = operation.trim();
  if (trimmedOperation.length === 0) {
    throw new AppError("Task operation cannot be empty or whitespace only", 400);
  }

  if (trimmedOperation.length > MAX_OPERATION_LENGTH) {
    throw new AppError(
      `Task operation cannot exceed ${MAX_OPERATION_LENGTH} characters`,
      400
    );
  }

  // 4. Validate input
  if (input === undefined || input === null) {
    throw new AppError("Task input is required", 400);
  }

  let inputToStore;
  if (typeof input === "string") {
    const trimmedInput = input.trim();
    if (trimmedInput.length === 0) {
      throw new AppError("Task input cannot be empty or whitespace only", 400);
    }
    inputToStore = trimmedInput;
  } else if (typeof input === "object") {
    if (Array.isArray(input) ? input.length === 0 : Object.keys(input).length === 0) {
      throw new AppError("Task input object cannot be empty", 400);
    }
    try {
      inputToStore = JSON.stringify(input);
    } catch {
      throw new AppError("Task input must be a serializable JSON object", 400);
    }
  } else {
    throw new AppError("Task input must be a string or a JSON object", 400);
  }

  // 5. Create task using Mongoose model
  // Only assign authorized fields: userId, title, input, operation.
  // Defaults handle status ("pending"), result, error, logs, timestamps.
  let task;
  try {
    task = await Task.create({
      userId,
      title: trimmedTitle,
      input: inputToStore,
      operation: trimmedOperation,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      throw new AppError(messages.join(", "), 400);
    }
    throw error;
  }

  // 6. Publish job to Redis Streams for asynchronous worker processing
  try {
    await queueService.publishTaskJob({
      taskId: task._id.toString(),
      operation: task.operation,
      input: task.input,
    });
  } catch (queueError) {
    // Compensation strategy:
    // If Redis publishing fails after MongoDB task creation, do not leave the task
    // silently pending or delete it blindly. Update status to 'failed' with failure reason
    // and append an error log to preserve full diagnostic context.
    const failureReason = queueError.message || "Failed to enqueue task for processing";
    logger.error(
      { taskId: task._id.toString(), error: failureReason },
      "Task enqueueing failed; applying MongoDB compensation"
    );

    try {
      const compensatedTask = await Task.findOneAndUpdate(
        {
          _id: task._id,
          status: "pending",
        },
        {
          $set: {
            status: "failed",
            error: "Task created but failed to enqueue for background processing",
          },
          $push: {
            logs: {
              message: `Enqueue failed: ${failureReason}`,
              level: "error",
              timestamp: new Date(),
            },
          },
        },
        {
          runValidators: true,
        }
      );

      if (!compensatedTask) {
        logger.warn(
          { taskId: task._id.toString() },
          "Task was not in pending status during enqueue compensation; status preserved"
        );
      }
    } catch (compensationError) {
      logger.error(
        { taskId: task._id.toString(), error: compensationError.message },
        "Compensation update failed after Redis enqueueing error"
      );
    }

    throw new AppError("Task created but failed to enqueue for background processing", 500);
  }

  return formatTaskResponse(task);
}

/**
 * Retrieves paginated tasks belonging strictly to the authenticated user.
 *
 * @param {object} params
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {string|number|undefined} params.page
 * @param {string|number|undefined} params.limit
 * @returns {Promise<{ tasks: Array<object>, pagination: { page: number, limit: number, totalTasks: number, totalPages: number } }>}
 */
async function getTasks({ userId, page: rawPage, limit: rawLimit }) {
  // 1. Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError("Invalid user identity", 401);
  }

  // 2. Validate and parse pagination parameters
  const { page, limit } = parsePaginationParams(rawPage, rawLimit);
  const skip = (page - 1) * limit;

  // 3. Query tasks scoped exclusively by userId, sorted by createdAt descending
  const query = { userId };

  const [tasks, totalTasks] = await Promise.all([
    Task.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Task.countDocuments(query),
  ]);

  const totalPages = totalTasks === 0 ? 0 : Math.ceil(totalTasks / limit);

  return {
    tasks: tasks.map(formatTaskResponse),
    pagination: {
      page,
      limit,
      totalTasks,
      totalPages,
    },
  };
}

/**
 * Retrieves a single task by ID scoped to the authenticated user.
 *
 * @param {object} params
 * @param {string} params.taskId
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @returns {Promise<object>} Sanitized task response object
 */
async function getTaskById({ taskId, userId }) {
  // 1. Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError("Invalid user identity", 401);
  }

  // 2. Validate taskId format
  if (
    !taskId ||
    typeof taskId !== "string" ||
    !OBJECT_ID_REGEX.test(taskId) ||
    !mongoose.Types.ObjectId.isValid(taskId)
  ) {
    throw new AppError("Invalid task ID format", 400);
  }

  // 3. User-scoped task query
  const task = await Task.findOne({ _id: taskId, userId });

  // 4. Return 404 if task does not exist or belongs to another user
  if (!task) {
    throw new AppError("Task not found", 404);
  }

  return formatTaskResponse(task);
}

/**
 * Updates permitted fields of a task owned by the authenticated user.
 *
 * @param {object} params
 * @param {string} params.taskId
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @param {object} params.updateData
 * @returns {Promise<object>} Sanitized updated task response object
 */
async function updateTask({ taskId, userId, updateData }) {
  // 1. Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError("Invalid user identity", 401);
  }

  // 2. Validate taskId format
  if (
    !taskId ||
    typeof taskId !== "string" ||
    !OBJECT_ID_REGEX.test(taskId) ||
    !mongoose.Types.ObjectId.isValid(taskId)
  ) {
    throw new AppError("Invalid task ID format", 400);
  }

  // 3. Validate request body presence and object type
  if (!updateData || typeof updateData !== "object" || Array.isArray(updateData)) {
    throw new AppError("Request body must be a JSON object", 400);
  }

  const keys = Object.keys(updateData);
  if (keys.length === 0) {
    throw new AppError("Request body cannot be empty", 400);
  }

  // 4. Reject attempts to update protected fields or unpermitted keys
  for (const key of keys) {
    if (PROTECTED_FIELDS.includes(key)) {
      throw new AppError(`Field '${key}' is protected and cannot be updated`, 400);
    }
    if (!PERMITTED_UPDATE_FIELDS.includes(key)) {
      throw new AppError(`Field '${key}' is not permitted for update`, 400);
    }
  }

  const updatesToApply = {};

  // 5. Validate title if supplied
  if ("title" in updateData) {
    const title = updateData.title;
    if (title === undefined || title === null || typeof title !== "string") {
      throw new AppError("Task title must be a string", 400);
    }
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      throw new AppError("Task title cannot be empty or whitespace only", 400);
    }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      throw new AppError(
        `Task title cannot exceed ${MAX_TITLE_LENGTH} characters`,
        400
      );
    }
    updatesToApply.title = trimmedTitle;
  }

  // 6. Validate operation if supplied
  if ("operation" in updateData) {
    const operation = updateData.operation;
    if (operation === undefined || operation === null || typeof operation !== "string") {
      throw new AppError("Task operation must be a string", 400);
    }
    const trimmedOperation = operation.trim();
    if (trimmedOperation.length === 0) {
      throw new AppError("Task operation cannot be empty or whitespace only", 400);
    }
    if (trimmedOperation.length > MAX_OPERATION_LENGTH) {
      throw new AppError(
        `Task operation cannot exceed ${MAX_OPERATION_LENGTH} characters`,
        400
      );
    }
    updatesToApply.operation = trimmedOperation;
  }

  // 7. Validate input if supplied
  if ("input" in updateData) {
    const input = updateData.input;
    if (input === undefined || input === null) {
      throw new AppError("Task input cannot be null or undefined", 400);
    }

    if (typeof input === "string") {
      const trimmedInput = input.trim();
      if (trimmedInput.length === 0) {
        throw new AppError("Task input cannot be empty or whitespace only", 400);
      }
      updatesToApply.input = trimmedInput;
    } else if (typeof input === "object") {
      if (Array.isArray(input) ? input.length === 0 : Object.keys(input).length === 0) {
        throw new AppError("Task input object cannot be empty", 400);
      }
      try {
        updatesToApply.input = JSON.stringify(input);
      } catch {
        throw new AppError("Task input must be a serializable JSON object", 400);
      }
    } else {
      throw new AppError("Task input must be a string or a JSON object", 400);
    }
  }

  // 8. Ensure at least one permitted field is being updated
  if (Object.keys(updatesToApply).length === 0) {
    throw new AppError("No permitted update fields provided", 400);
  }

  // 9. Execute ownership-scoped find and update
  let task;
  try {
    task = await Task.findOneAndUpdate(
      { _id: taskId, userId },
      { $set: updatesToApply },
      { returnDocument: "after", runValidators: true }
    );
  } catch (error) {
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      throw new AppError(messages.join(", "), 400);
    }
    throw error;
  }

  // 10. If task does not exist or belongs to another user, return 404
  if (!task) {
    throw new AppError("Task not found", 404);
  }

  return formatTaskResponse(task);
}

/**
 * Deletes a task owned strictly by the authenticated user.
 *
 * @param {object} params
 * @param {string} params.taskId
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @returns {Promise<{ id: string }>} Safe deleted task response object containing ID
 */
async function deleteTask({ taskId, userId }) {
  // 1. Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError("Invalid user identity", 401);
  }

  // 2. Validate taskId format
  if (
    !taskId ||
    typeof taskId !== "string" ||
    !OBJECT_ID_REGEX.test(taskId) ||
    !mongoose.Types.ObjectId.isValid(taskId)
  ) {
    throw new AppError("Invalid task ID format", 400);
  }

  // 3. User-scoped atomic deletion
  const task = await Task.findOneAndDelete({ _id: taskId, userId });

  // 4. Return 404 if task does not exist or belongs to another user
  if (!task) {
    throw new AppError("Task not found", 404);
  }

  return {
    id: task._id.toString(),
  };
}

/**
 * Retrieves execution logs for a task owned strictly by the authenticated user.
 *
 * @param {object} params
 * @param {string} params.taskId
 * @param {string|mongoose.Types.ObjectId} params.userId
 * @returns {Promise<{ taskId: string, status: string, logs: Array<object> }>}
 */
async function getTaskLogs({ taskId, userId }) {
  // 1. Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    throw new AppError("Invalid user identity", 401);
  }

  // 2. Validate taskId format using strict ObjectId validation approach
  if (
    !taskId ||
    typeof taskId !== "string" ||
    !OBJECT_ID_REGEX.test(taskId) ||
    !mongoose.Types.ObjectId.isValid(taskId)
  ) {
    throw new AppError("Invalid task ID format", 400);
  }

  // 3. Query MongoDB using an ownership-scoped filter selecting logs and status
  const task = await Task.findOne({ _id: taskId, userId }).select("logs status");

  // 4. Return HTTP 404 using existing AppError convention if task does not exist or belongs to another user
  if (!task) {
    throw new AppError("Task not found", 404);
  }

  // 5. Return taskId, status, and logs preserving log structure
  return {
    taskId: task._id.toString(),
    status: task.status,
    logs: task.logs,
  };
}

module.exports = {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  getTaskLogs,
  formatTaskResponse,
  parsePaginationParams,
};

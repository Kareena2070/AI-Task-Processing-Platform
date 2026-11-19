"use strict";

const taskService = require("../services/taskService");
const AppError = require("../utils/appError");

/**
 * Controller to handle POST /api/tasks
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function createTask(req, res, next) {
  try {
    if (!req.user || !req.user._id) {
      throw new AppError("Authentication required", 401);
    }

    // Extract only authorized input fields from req.validated.body with fallback to req.body
    // Deliberately ignore any client-supplied userId, status, result, error, logs, etc.
    const body = (req.validated && req.validated.body) || req.body || {};
    const { title, input, operation } = body;

    const task = await taskService.createTask({
      userId: req.user._id,
      title,
      input,
      operation,
    });

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: {
        task,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller to handle GET /api/tasks
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function getTasks(req, res, next) {
  try {
    if (!req.user || !req.user._id) {
      throw new AppError("Authentication required", 401);
    }

    // Extract pagination parameters from req.validated.query with fallback to req.query
    // Deliberately ignore any query-supplied userId or other filter overrides
    const query = (req.validated && req.validated.query) || req.query || {};
    const { page, limit } = query;

    const result = await taskService.getTasks({
      userId: req.user._id,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      message: "Tasks retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller to handle GET /api/tasks/:taskId
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function getTaskById(req, res, next) {
  try {
    if (!req.user || !req.user._id) {
      throw new AppError("Authentication required", 401);
    }

    const params = (req.validated && req.validated.params) || req.params || {};
    const { taskId } = params;

    const task = await taskService.getTaskById({
      taskId,
      userId: req.user._id,
    });

    res.status(200).json({
      success: true,
      message: "Task retrieved successfully",
      data: {
        task,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller to handle PATCH /api/tasks/:taskId
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function updateTask(req, res, next) {
  try {
    if (!req.user || !req.user._id) {
      throw new AppError("Authentication required", 401);
    }

    const params = (req.validated && req.validated.params) || req.params || {};
    const { taskId } = params;
    const updateData = (req.validated && req.validated.body) || req.body;

    const task = await taskService.updateTask({
      taskId,
      userId: req.user._id,
      updateData,
    });

    res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: {
        task,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller to handle DELETE /api/tasks/:taskId
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function deleteTask(req, res, next) {
  try {
    if (!req.user || !req.user._id) {
      throw new AppError("Authentication required", 401);
    }

    const params = (req.validated && req.validated.params) || req.params || {};
    const { taskId } = params;

    const result = await taskService.deleteTask({
      taskId,
      userId: req.user._id,
    });

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
      data: {
        task: result,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller to handle GET /api/tasks/:taskId/logs
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function getTaskLogs(req, res, next) {
  try {
    if (!req.user || !req.user._id) {
      throw new AppError("Authentication required", 401);
    }

    const params = (req.validated && req.validated.params) || req.params || {};
    const { taskId } = params;

    const result = await taskService.getTaskLogs({
      taskId,
      userId: req.user._id,
    });

    res.status(200).json({
      success: true,
      message: "Task logs retrieved successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask,
  getTaskLogs,
};

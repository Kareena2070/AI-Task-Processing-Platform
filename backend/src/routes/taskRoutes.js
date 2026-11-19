"use strict";

const express = require("express");
const taskController = require("../controllers/taskController");
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validate");
const {
  createTaskSchema,
  getTasksQuerySchema,
  taskIdParamSchema,
  updateTaskSchema,
} = require("../validators/taskSchemas");
const { apiLimiter, pollingLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();

// POST /api/tasks (rate-limited by apiLimiter before authMiddleware and validation)
router.post(
  "/",
  apiLimiter,
  authMiddleware,
  validate({ body: createTaskSchema }),
  taskController.createTask
);

// GET /api/tasks (rate-limited by apiLimiter before authMiddleware and validation)
router.get(
  "/",
  apiLimiter,
  authMiddleware,
  validate({ query: getTasksQuerySchema }),
  taskController.getTasks
);

// GET /api/tasks/:taskId/logs (rate-limited by pollingLimiter before authMiddleware and validation)
router.get(
  "/:taskId/logs",
  pollingLimiter,
  authMiddleware,
  validate({ params: taskIdParamSchema }),
  taskController.getTaskLogs
);

// GET /api/tasks/:taskId (rate-limited by pollingLimiter before authMiddleware and validation)
router.get(
  "/:taskId",
  pollingLimiter,
  authMiddleware,
  validate({ params: taskIdParamSchema }),
  taskController.getTaskById
);

// PATCH /api/tasks/:taskId (rate-limited by apiLimiter before authMiddleware and validation)
router.patch(
  "/:taskId",
  apiLimiter,
  authMiddleware,
  validate({ params: taskIdParamSchema, body: updateTaskSchema }),
  taskController.updateTask
);

// DELETE /api/tasks/:taskId (rate-limited by apiLimiter before authMiddleware and validation)
router.delete(
  "/:taskId",
  apiLimiter,
  authMiddleware,
  validate({ params: taskIdParamSchema }),
  taskController.deleteTask
);

module.exports = router;

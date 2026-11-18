"use strict";

const express = require("express");
const taskController = require("../controllers/taskController");
const authMiddleware = require("../middlewares/authMiddleware");

const router = express.Router();

// POST /api/tasks (protected by authMiddleware)
router.post("/", authMiddleware, taskController.createTask);

// GET /api/tasks (protected by authMiddleware)
router.get("/", authMiddleware, taskController.getTasks);

// GET /api/tasks/:taskId (protected by authMiddleware)
router.get("/:taskId", authMiddleware, taskController.getTaskById);

// PATCH /api/tasks/:taskId (protected by authMiddleware)
router.patch("/:taskId", authMiddleware, taskController.updateTask);

// DELETE /api/tasks/:taskId (protected by authMiddleware)
router.delete("/:taskId", authMiddleware, taskController.deleteTask);

module.exports = router;

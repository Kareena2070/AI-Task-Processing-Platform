const express = require("express");
const requestLogger = require("./middlewares/requestLogger");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
const authRoutes = require("./routes/authRoutes");
const taskRoutes = require("./routes/taskRoutes");

const app = express();

// Body parsing middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP request logging middleware
app.use(requestLogger);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "AI Task Processing Platform API is running",
  });
});

// Authentication routes
app.use("/api/auth", authRoutes);

// Task routes
app.use("/api/tasks", taskRoutes);

// Handle undefined routes (404)
app.use(notFound);

// Centralized error handling middleware
app.use(errorHandler);

module.exports = app;

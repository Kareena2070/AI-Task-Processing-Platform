const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const requestLogger = require("./middlewares/requestLogger");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");
const authRoutes = require("./routes/authRoutes");
const taskRoutes = require("./routes/taskRoutes");

const app = express();

// HTTP security headers
app.use(helmet());

// CORS configuration
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function getAllowedOrigins() {
  if (!process.env.CORS_ORIGIN) {
    return DEFAULT_ALLOWED_ORIGINS;
  }
  const parsed = process.env.CORS_ORIGIN
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_ALLOWED_ORIGINS;
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients or requests without an Origin header
      if (!origin) {
        return callback(null, true);
      }
      const allowed = getAllowedOrigins();
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
      // Withhold CORS headers for disallowed origins without throwing a server error
      return callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Body parsing middlewares with explicit size limits
const maxJsonSize = process.env.MAX_REQUEST_SIZE || "1mb";
app.use(express.json({ limit: maxJsonSize }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

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

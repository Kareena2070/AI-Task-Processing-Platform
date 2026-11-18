const mongoose = require("mongoose");

const ALLOWED_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
];

const ALLOWED_LOG_LEVELS = ["info", "warn", "error", "debug"];

const taskLogSchema = new mongoose.Schema(
  {
    message: {
      type: String,
      required: [true, "Log message is required"],
      trim: true,
      minlength: [1, "Log message cannot be empty"],
    },
    timestamp: {
      type: Date,
      default: Date.now,
      required: [true, "Log timestamp is required"],
    },
    level: {
      type: String,
      enum: {
        values: ALLOWED_LOG_LEVELS,
        message: `Log level must be one of: ${ALLOWED_LOG_LEVELS.join(", ")}`,
      },
      default: "info",
    },
  },
  {
    _id: false,
  }
);

const taskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    title: {
      type: String,
      required: [true, "Task title is required"],
      trim: true,
      minlength: [1, "Task title cannot be empty"],
      maxlength: [200, "Task title cannot exceed 200 characters"],
    },
    input: {
      type: String,
      required: [true, "Task input is required"],
    },
    operation: {
      type: String,
      required: [true, "Task operation is required"],
      trim: true,
      minlength: [1, "Task operation cannot be empty"],
      maxlength: [100, "Task operation cannot exceed 100 characters"],
    },
    status: {
      type: String,
      enum: {
        values: ALLOWED_STATUSES,
        message: `Task status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
      },
      default: "pending",
    },
    result: {
      type: String,
      default: null,
    },
    error: {
      type: String,
      default: null,
    },
    logs: {
      type: [taskLogSchema],
      default: [],
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
      validate: {
        validator: function (value) {
          if (!value || !this.startedAt) {
            return true;
          }
          return value >= this.startedAt;
        },
        message: "completedAt cannot be earlier than startedAt",
      },
    },
    workerId: {
      type: String,
      default: null,
    },
    leaseToken: {
      type: String,
      default: null,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes:
// 1. Compound index { userId: 1, createdAt: -1 }:
//    Optimizes user task queries ordered by creation date, and serves standalone
//    userId lookups via left-prefix matching without needing a redundant single-field index.
taskSchema.index({ userId: 1, createdAt: -1 });

// 2. Status index:
//    Enables fast worker queries for tasks in specific states (e.g. "pending", "processing").
taskSchema.index({ status: 1 });

// 3. Global creation date index:
//    Optimizes system-wide recency sorting.
taskSchema.index({ createdAt: -1 });

// Clean JSON and object transformations
taskSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

taskSchema.set("toObject", {
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Task = mongoose.model("Task", taskSchema);

module.exports = Task;

"use strict";

const { z } = require("zod");
const {
  objectIdSchema,
  paginationSchema,
} = require("./commonSchemas");

const MAX_TITLE_LENGTH = 200;
const MAX_OPERATION_LENGTH = 100;

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

const PERMITTED_UPDATE_FIELDS = ["title", "input", "operation"];

/**
 * Checks whether a value is a plain JavaScript object.
 * Returns true for {} or Object.create(null).
 * Returns false for null, primitives, arrays, Date, Map, Set, RegExp, and class instances.
 *
 * @param {unknown} val
 * @returns {boolean}
 */
function isPlainObject(val) {
  if (val === null || typeof val !== "object" || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  if (proto === null || proto === Object.prototype) {
    return true;
  }
  return (
    Object.prototype.toString.call(val) === "[object Object]" &&
    proto.constructor &&
    proto.constructor.name === "Object"
  );
}

/**
 * Reusable schema for task title.
 * Validates string type, trims whitespace, enforces bounds 1-200 characters,
 * and preserves exact service error messages.
 */
const titleSchema = z
  .string({
    required_error: "Task title is required",
    invalid_type_error: "Task title must be a string",
  })
  .superRefine((val, ctx) => {
    const trimmed = val.trim();
    if (trimmed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task title cannot be empty or whitespace only",
      });
      return;
    }
    if (trimmed.length > MAX_TITLE_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Task title cannot exceed ${MAX_TITLE_LENGTH} characters`,
      });
    }
  })
  .transform((val) => val.trim());

/**
 * Reusable schema for task operation.
 * Validates string type, trims whitespace, enforces bounds 1-100 characters,
 * does not restrict to an enum, and preserves exact service error messages.
 */
const operationSchema = z
  .string({
    required_error: "Task operation is required",
    invalid_type_error: "Task operation must be a string",
  })
  .superRefine((val, ctx) => {
    const trimmed = val.trim();
    if (trimmed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task operation cannot be empty or whitespace only",
      });
      return;
    }
    if (trimmed.length > MAX_OPERATION_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Task operation cannot exceed ${MAX_OPERATION_LENGTH} characters`,
      });
    }
  })
  .transform((val) => val.trim());

/**
 * Reusable polymorphic schema for task input.
 * Accepts:
 * - Non-empty strings.
 * - Non-empty plain JSON objects.
 * - Non-empty JSON arrays.
 * Rejects:
 * - Missing values and null ("Task input is required").
 * - Empty strings and whitespace-only strings ("Task input cannot be empty or whitespace only").
 * - Empty objects and empty arrays ("Task input object cannot be empty").
 * - Numbers, booleans, Date, Map, Set, and non-plain objects ("Task input must be a string or a JSON object").
 * - Non-serializable JSON objects/arrays ("Task input must be a serializable JSON object").
 */
const inputSchema = z
  .any()
  .superRefine((val, ctx) => {
    if (val === undefined || val === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task input is required",
      });
      return;
    }

    if (typeof val === "string") {
      if (val.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Task input cannot be empty or whitespace only",
        });
      }
      return;
    }

    if (Array.isArray(val)) {
      if (val.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Task input object cannot be empty",
        });
        return;
      }
      try {
        JSON.stringify(val);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Task input must be a serializable JSON object",
        });
      }
      return;
    }

    if (isPlainObject(val)) {
      if (Object.keys(val).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Task input object cannot be empty",
        });
        return;
      }
      try {
        JSON.stringify(val);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Task input must be a serializable JSON object",
        });
      }
      return;
    }

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Task input must be a string or a JSON object",
    });
  })
  .transform((val) => (typeof val === "string" ? val.trim() : val));

/**
 * Schema for route parameters with taskId.
 * Validates 24-character hexadecimal ObjectId matching existing error convention.
 */
const taskIdParamSchema = z
  .object({
    taskId: objectIdSchema,
  })
  .strict();

/**
 * Schema for POST /api/tasks request body.
 * Validates title, operation, and input. Rejects unknown top-level fields.
 */
const createTaskSchema = z
  .object({
    title: titleSchema,
    operation: operationSchema,
    input: inputSchema,
  })
  .strict();

/**
 * Schema for GET /api/tasks query parameters.
 * Reuses paginationSchema from commonSchemas.js (page default 1, limit default 10, max limit 100).
 */
const getTasksQuerySchema = paginationSchema;

/**
 * Schema for PATCH /api/tasks/:taskId request body.
 * Enforces strict, deterministic validation matching taskService.js precedence:
 * 1. Request body must be a plain JSON object.
 * 2. Request body cannot be empty.
 * 3. Protected fields produce "Field '<key>' is protected and cannot be updated"
 *    before inner field validations run.
 * 4. Unpermitted fields produce "Field '<key>' is not permitted for update"
 *    before inner field validations run.
 * 5. At least one permitted field must be provided.
 * 6. Permitted fields (title, operation, input) are validated in sequential order.
 */
const updateTaskSchema = z
  .any()
  .superRefine((data, ctx) => {
    // 1. Validate request body presence and plain object type
    if (!data || typeof data !== "object" || Array.isArray(data) || !isPlainObject(data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Request body must be a JSON object",
      });
      return;
    }

    // 2. Reject empty bodies
    const keys = Object.keys(data);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Request body cannot be empty",
      });
      return;
    }

    // 3. Reject protected fields and unpermitted keys in object key order
    for (const key of keys) {
      if (PROTECTED_FIELDS.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Field '${key}' is protected and cannot be updated`,
        });
        return;
      }
      if (!PERMITTED_UPDATE_FIELDS.includes(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Field '${key}' is not permitted for update`,
        });
        return;
      }
    }

    // 4. Ensure at least one permitted field is present
    const hasPermittedField = PERMITTED_UPDATE_FIELDS.some(
      (field) => data[field] !== undefined
    );
    if (!hasPermittedField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "No permitted update fields provided",
      });
      return;
    }

    // 5. Validate title if supplied
    if ("title" in data) {
      const res = titleSchema.safeParse(data.title);
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue(issue);
        }
        return;
      }
    }

    // 6. Validate operation if supplied
    if ("operation" in data) {
      const res = operationSchema.safeParse(data.operation);
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue(issue);
        }
        return;
      }
    }

    // 7. Validate input if supplied
    if ("input" in data) {
      const res = inputSchema.safeParse(data.input);
      if (!res.success) {
        for (const issue of res.error.issues) {
          ctx.addIssue(issue);
        }
        return;
      }
    }
  })
  .transform((data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return data;
    }
    const result = {};
    if ("title" in data && typeof data.title === "string") {
      result.title = data.title.trim();
    }
    if ("operation" in data && typeof data.operation === "string") {
      result.operation = data.operation.trim();
    }
    if ("input" in data) {
      result.input = typeof data.input === "string" ? data.input.trim() : data.input;
    }
    return result;
  });

module.exports = {
  MAX_TITLE_LENGTH,
  MAX_OPERATION_LENGTH,
  PROTECTED_FIELDS,
  PERMITTED_UPDATE_FIELDS,
  isPlainObject,
  titleSchema,
  operationSchema,
  inputSchema,
  taskIdParamSchema,
  createTaskSchema,
  getTasksQuerySchema,
  updateTaskSchema,
};

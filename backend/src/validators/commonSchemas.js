"use strict";

const { z } = require("zod");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
const POSITIVE_INT_REGEX = /^[1-9]\d*$/;
const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Reusable schema for email addresses.
 * Validates string type, trims leading/trailing whitespace, converts to lowercase,
 * and enforces the standard email pattern.
 */
const emailSchema = z
  .string({
    required_error: "Email is required",
    invalid_type_error: "Email must be a string",
  })
  .trim()
  .toLowerCase()
  .regex(EMAIL_REGEX, "Please provide a valid email address");

/**
 * Reusable schema for passwords.
 * Enforces string type, minimum 8 characters, and rejects whitespace-only values.
 * Does not trim or alter the input to prevent changing password hashes.
 */
const passwordSchema = z
  .string({
    required_error: "Password is required",
    invalid_type_error: "Password must be a string",
  })
  .superRefine((val, ctx) => {
    if (val.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password cannot be whitespace only",
      });
      return;
    }
    if (val.length < MIN_PASSWORD_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
      });
    }
  });

/**
 * Reusable schema for 24-character hexadecimal MongoDB ObjectIds.
 * Supports case-insensitive hexadecimal characters (0-9, a-f, A-F).
 */
const objectIdSchema = z
  .string({
    required_error: "ID is required",
    invalid_type_error: "Invalid task ID format",
  })
  .regex(OBJECT_ID_REGEX, "Invalid task ID format");

/**
 * Reusable schema for page query parameter.
 * Defaults to 1 if omitted, accepts only positive integer strings,
 * rejects decimals, zeros, negatives, and malformed strings. Returns number.
 */
const pageSchema = z
  .union([z.string(), z.number()])
  .optional()
  .transform((val, ctx) => {
    if (val === undefined) {
      return DEFAULT_PAGE;
    }
    const str = String(val).trim();
    if (!POSITIVE_INT_REGEX.test(str)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Page must be a positive integer greater than 0",
      });
      return z.NEVER;
    }
    return parseInt(str, 10);
  });

/**
 * Reusable schema for limit query parameter.
 * Defaults to 10 if omitted, accepts only positive integer strings,
 * rejects decimals, zeros, negatives, malformed strings, and values > 100. Returns number.
 */
const limitSchema = z
  .union([z.string(), z.number()])
  .optional()
  .transform((val, ctx) => {
    if (val === undefined) {
      return DEFAULT_LIMIT;
    }
    const str = String(val).trim();
    if (!POSITIVE_INT_REGEX.test(str)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Limit must be a positive integer greater than 0",
      });
      return z.NEVER;
    }
    const num = parseInt(str, 10);
    if (num > MAX_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Limit cannot exceed ${MAX_LIMIT}`,
      });
      return z.NEVER;
    }
    return num;
  });

/**
 * Combined pagination schema for query parameters.
 */
const paginationSchema = z.object({
  page: pageSchema,
  limit: limitSchema,
});

module.exports = {
  EMAIL_REGEX,
  OBJECT_ID_REGEX,
  POSITIVE_INT_REGEX,
  MIN_PASSWORD_LENGTH,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  emailSchema,
  passwordSchema,
  objectIdSchema,
  pageSchema,
  limitSchema,
  paginationSchema,
};

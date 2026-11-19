"use strict";

const { z } = require("zod");
const { emailSchema, passwordSchema } = require("./commonSchemas");

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 100;

/**
 * Schema for POST /api/auth/register request body.
 * Enforces strict object structure, trimmed name between 2-100 characters,
 * standardized normalized email, and password meeting length/non-whitespace rules.
 * Disallows unrecognized/extra fields.
 */
const registerSchema = z
  .object({
    name: z
      .string({
        required_error: "Name is required",
        invalid_type_error: "Name must be a string",
      })
      .trim()
      .min(
        MIN_NAME_LENGTH,
        `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters long`
      )
      .max(
        MAX_NAME_LENGTH,
        `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters long`
      ),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

/**
 * Schema for POST /api/auth/login request body.
 * Enforces strict object structure, normalized email, and password meeting
 * security constraints. Disallows unrecognized/extra fields.
 */
const loginSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

module.exports = {
  MIN_NAME_LENGTH,
  MAX_NAME_LENGTH,
  registerSchema,
  loginSchema,
};

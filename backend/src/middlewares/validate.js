"use strict";

const AppError = require("../utils/appError");

/**
 * Creates an Express middleware to validate request segments against Zod schemas.
 *
 * @param {object} schemas
 * @param {import("zod").ZodTypeAny} [schemas.body] - Schema for req.body
 * @param {import("zod").ZodTypeAny} [schemas.query] - Schema for req.query
 * @param {import("zod").ZodTypeAny} [schemas.params] - Schema for req.params
 * @returns {import("express").RequestHandler}
 */
function validate(schemas = {}) {
  const { body, query, params } = schemas;

  return (req, res, next) => {
    try {
      // Initialize or preserve existing req.validated object across multiple validation middlewares
      if (!req.validated || typeof req.validated !== "object") {
        req.validated = {};
      }

      // Validate route parameters (never directly reassign req.params)
      if (params) {
        req.validated.params = params.parse(req.params);
      }

      // Validate query string parameters (never directly reassign req.query)
      if (query) {
        req.validated.query = query.parse(req.query);
      }

      // Validate request body
      if (body) {
        req.validated.body = body.parse(req.body);
        req.body = req.validated.body;
      }

      next();
    } catch (err) {
      // Check if error is a Zod validation error
      if (err && err.name === "ZodError" && Array.isArray(err.issues) && err.issues.length > 0) {
        const firstIssue = err.issues[0];
        return next(new AppError(firstIssue.message, 400));
      }

      // Forward any unexpected or non-validation errors to Express centralized error handler
      next(err);
    }
  };
}

module.exports = validate;

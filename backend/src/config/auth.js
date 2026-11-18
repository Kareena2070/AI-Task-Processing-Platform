"use strict";

const MIN_SECRET_LENGTH = 32;
const DEFAULT_EXPIRES_IN = "1d";
const SIGNING_ALGORITHM = "HS256";

/**
 * Validates JWT authentication configuration values.
 *
 * @param {NodeJS.ProcessEnv} env - Environment variables object (defaults to process.env)
 * @returns {Readonly<{secret: string, expiresIn: string, algorithm: string}>}
 */
function validateAuthConfig(env = process.env) {
  const secret = env.JWT_SECRET;
  const expiresIn = env.JWT_EXPIRES_IN;

  if (!secret || typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error(
      "JWT configuration error: JWT_SECRET environment variable is required and cannot be empty."
    );
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `JWT configuration error: JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long for security.`
    );
  }

  const configuredExpiresIn =
    expiresIn && typeof expiresIn === "string" && expiresIn.trim().length > 0
      ? expiresIn.trim()
      : DEFAULT_EXPIRES_IN;

  return Object.freeze({
    secret,
    expiresIn: configuredExpiresIn,
    algorithm: SIGNING_ALGORITHM,
  });
}

const authConfig = validateAuthConfig();

module.exports = authConfig;

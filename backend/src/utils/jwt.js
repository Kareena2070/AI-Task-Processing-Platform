"use strict";

const jwt = require("jsonwebtoken");
const authConfig = require("../config/auth");
const AppError = require("./appError");

/**
 * Validates and normalizes user ID input.
 *
 * @param {string|number|object} userId - User identifier (string, number, or ObjectId)
 * @returns {string} Normalized user ID string
 */
function normalizeUserId(userId) {
  if (!userId) {
    throw new AppError("User ID is required to generate an authentication token", 400);
  }

  let normalized;
  if (typeof userId === "string") {
    normalized = userId.trim();
  } else if (typeof userId === "number") {
    normalized = String(userId);
  } else if (
    typeof userId === "object" &&
    userId !== null &&
    (typeof userId.toHexString === "function" ||
      userId.constructor?.name === "ObjectId" ||
      userId._bsontype === "ObjectID" ||
      (typeof userId.toString === "function" && userId.toString() !== "[object Object]"))
  ) {
    normalized = userId.toString().trim();
  } else {
    throw new AppError("Invalid user ID provided", 400);
  }

  if (!normalized) {
    throw new AppError("User ID cannot be empty", 400);
  }

  return normalized;
}

/**
 * Generates a signed JWT containing minimal user identity claims.
 *
 * @param {string|number|object} userId - Target user identifier
 * @returns {string} Signed JSON Web Token
 */
function generateToken(userId) {
  const normalizedId = normalizeUserId(userId);

  const payload = {
    userId: normalizedId,
  };

  try {
    return jwt.sign(payload, authConfig.secret, {
      algorithm: authConfig.algorithm,
      expiresIn: authConfig.expiresIn,
    });
  } catch (error) {
    throw new AppError("Failed to generate authentication token", 500);
  }
}

/**
 * Verifies and decodes a signed JWT.
 *
 * @param {string} token - Signed JSON Web Token
 * @returns {object} Decoded token payload
 */
function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.trim()) {
    throw new AppError("Authentication token is required", 401);
  }

  try {
    const decoded = jwt.verify(token.trim(), authConfig.secret, {
      algorithms: [authConfig.algorithm],
    });

    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      throw new AppError("Invalid token payload", 401);
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      const expiredError = new AppError("Authentication token has expired", 401);
      expiredError.name = "TokenExpiredError";
      expiredError.expiredAt = error.expiredAt;
      throw expiredError;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      const jwtError = new AppError("Invalid authentication token", 401);
      jwtError.name = "JsonWebTokenError";
      throw jwtError;
    }

    if (error instanceof jwt.NotBeforeError) {
      const nbfError = new AppError("Authentication token is not active yet", 401);
      nbfError.name = "NotBeforeError";
      throw nbfError;
    }

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Failed to verify authentication token", 401);
  }
}

module.exports = {
  generateToken,
  verifyToken,
};

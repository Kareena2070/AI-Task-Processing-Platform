"use strict";

const mongoose = require("mongoose");
const User = require("../models/User");
const AppError = require("../utils/appError");
const { verifyToken } = require("../utils/jwt");

const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Authentication middleware to verify JWT Bearer tokens and attach the
 * authenticated user document to the Express request object.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function authMiddleware(req, res, next) {
  try {
    // 1. Read the Authorization header
    const authHeader = req.headers && (req.headers.authorization || req.headers.Authorization);

    if (!authHeader || typeof authHeader !== "string") {
      throw new AppError("Authorization header is missing or malformed", 401);
    }

    // 2. Require the strict format "Bearer <token>"
    const parts = authHeader.trim().split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1].trim()) {
      throw new AppError("Authorization header is missing or malformed", 401);
    }

    const token = parts[1].trim();

    // 3. Verify the token using existing verifyToken utility
    const decoded = verifyToken(token);

    // 4. Extract and validate the userId claim
    const userId = decoded.userId;
    if (
      !userId ||
      typeof userId !== "string" ||
      !OBJECT_ID_REGEX.test(userId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      throw new AppError("Invalid user identity in authentication token", 401);
    }

    // 5. Find the user in MongoDB (password field is excluded by default via select: false)
    const user = await User.findById(userId);

    // 6. Return 401 if user no longer exists in database
    if (!user) {
      throw new AppError("User belonging to this token no longer exists", 401);
    }

    // 7. Attach authenticated user to req.user (password hash is not present)
    req.user = user;

    // 8. Proceed to next middleware or route handler
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authMiddleware;

"use strict";

const User = require("../models/User");
const AppError = require("../utils/appError");
const { generateToken } = require("../utils/jwt");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 100;

/**
 * Validates registration input and creates a new user.
 *
 * @param {object} userData
 * @param {string} userData.name
 * @param {string} userData.email
 * @param {string} userData.password
 * @returns {Promise<{ user: { id: string, name: string, email: string }, token: string }>}
 */
async function registerUser({ name, email, password }) {
  // 1. Check required fields presence
  if (!name || !email || !password) {
    throw new AppError("Name, email, and password are required", 400);
  }

  // 2. Validate types
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
    throw new AppError("Invalid input format for registration fields", 400);
  }

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();

  // 3. Validate name bounds
  if (trimmedName.length < MIN_NAME_LENGTH || trimmedName.length > MAX_NAME_LENGTH) {
    throw new AppError(
      `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters long`,
      400
    );
  }

  // 4. Validate email format
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError("Please provide a valid email address", 400);
  }

  // 5. Validate password minimum length and reject whitespace-only passwords
  if (password.trim().length === 0) {
    throw new AppError("Password cannot be whitespace only", 400);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
      400
    );
  }

  // 6. Check for duplicate email (pre-check before database write)
  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    throw new AppError("An account with this email address already exists", 409);
  }

  // 7. Create user via Mongoose model (pre-save hook hashes password with bcrypt)
  let user;
  try {
    user = await User.create({
      name: trimmedName,
      email: normalizedEmail,
      password,
    });
  } catch (error) {
    // Handle race-condition MongoDB duplicate key error (E11000)
    if (error.code === 11000) {
      throw new AppError("An account with this email address already exists", 409);
    }

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      throw new AppError(messages.join(", "), 400);
    }

    throw error;
  }

  // 8. Generate JWT for the newly created user
  const token = generateToken(user._id);

  // 9. Return sanitized user info and JWT (password and hash are completely excluded)
  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    },
    token,
  };
}

/**
 * Authenticates a user with email and password, returning sanitized user info and a JWT.
 *
 * @param {object} credentials
 * @param {string} credentials.email
 * @param {string} credentials.password
 * @returns {Promise<{ user: { id: string, name: string, email: string }, token: string }>}
 */
async function loginUser({ email, password }) {
  // 1. Validate presence of credentials
  if (!email || !password) {
    throw new AppError("Email and password are required", 400);
  }

  // 2. Validate input types
  if (typeof email !== "string" || typeof password !== "string") {
    throw new AppError("Invalid input format for login credentials", 400);
  }

  const normalizedEmail = email.trim().toLowerCase();

  // 3. Reject empty or whitespace-only inputs
  if (normalizedEmail.length === 0) {
    throw new AppError("Email cannot be whitespace only", 400);
  }

  if (password.trim().length === 0) {
    throw new AppError("Password cannot be whitespace only", 400);
  }

  // Validate email format
  if (!EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError("Please provide a valid email address", 400);
  }

  // 4. Find user by normalized email and explicitly select password field
  const user = await User.findOne({ email: normalizedEmail }).select("+password");

  // 5. If user does not exist, return generic invalid credentials error (401)
  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  // 6. Verify password using the User model's comparePassword method
  const isMatch = await user.comparePassword(password);

  // 7. If password is incorrect, return the exact same generic error (401)
  if (!isMatch) {
    throw new AppError("Invalid email or password", 401);
  }

  // 8. Generate JWT using existing token utility
  const token = generateToken(user._id);

  // 9. Return sanitized user info and JWT (no password or hash)
  return {
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    },
    token,
  };
}

module.exports = {
  registerUser,
  loginUser,
};

"use strict";

const authService = require("../services/authService");

/**
 * Controller to handle POST /api/auth/register
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};
    const result = await authService.registerUser({ name, email, password });

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Controller to handle POST /api/auth/login
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    const result = await authService.loginUser({ email, password });

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  register,
  login,
};

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const SALT_ROUNDS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters long"],
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [EMAIL_REGEX, "Please provide a valid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters long"],
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// Hash password on save if modified or new
userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }
  this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
});

// Helper to hash password across update and replacement operations safely
async function hashUpdatePassword(update) {
  if (!update) {
    return;
  }

  // Reject aggregation pipeline updates targeting password to prevent plaintext storage
  if (Array.isArray(update)) {
    const pipelineStr = JSON.stringify(update);
    if (pipelineStr.includes('"password"')) {
      throw new Error(
        "Password updates via aggregation pipelines are not supported"
      );
    }
    return;
  }

  if (typeof update !== "object") {
    return;
  }

  // 1. Direct password field (updateOne, updateMany, findOneAndUpdate, replaceOne, findOneAndReplace)
  if (update.password !== undefined) {
    if (typeof update.password === "string") {
      update.password = await bcrypt.hash(update.password, SALT_ROUNDS);
    } else {
      throw new Error("Password must be a string");
    }
  }

  // 2. $set.password operator
  if (update.$set && update.$set.password !== undefined) {
    if (typeof update.$set.password === "string") {
      update.$set.password = await bcrypt.hash(update.$set.password, SALT_ROUNDS);
    } else {
      throw new Error("Password must be a string");
    }
  }

  // 3. $setOnInsert.password operator (used during upserts)
  if (update.$setOnInsert && update.$setOnInsert.password !== undefined) {
    if (typeof update.$setOnInsert.password === "string") {
      update.$setOnInsert.password = await bcrypt.hash(
        update.$setOnInsert.password,
        SALT_ROUNDS
      );
    } else {
      throw new Error("Password must be a string");
    }
  }

  // 4. Reject any unsupported operator targeting password
  for (const key of Object.keys(update)) {
    if (key.startsWith("$") && key !== "$set" && key !== "$setOnInsert") {
      if (
        update[key] &&
        typeof update[key] === "object" &&
        update[key].password !== undefined
      ) {
        throw new Error(
          `Password updates via unsupported update operator '${key}' are not allowed`
        );
      }
    }
  }
}

// Intercept all update and replacement operations to ensure passwords cannot be stored in plaintext
userSchema.pre(
  [
    "findOneAndUpdate",
    "updateOne",
    "updateMany",
    "replaceOne",
    "findOneAndReplace",
  ],
  async function () {
    const update = this.getUpdate();
    await hashUpdatePassword(update);
  }
);

// Compare candidate password against hashed password
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    throw new Error("Password field is not selected on this user document");
  }
  return bcrypt.compare(candidatePassword, this.password);
};

// Exclude password and internal fields from serialized JSON and object representations
userSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

userSchema.set("toObject", {
  transform: (doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;

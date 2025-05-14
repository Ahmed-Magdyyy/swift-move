const mongoose = require("mongoose");

const tokenBlacklistSchema = new mongoose.Schema({
  token: String,
  expiresAt: Date
});

tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("TokenBlacklist", tokenBlacklistSchema);
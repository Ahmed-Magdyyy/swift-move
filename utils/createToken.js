const jwt = require("jsonwebtoken");

// Access Token (short-lived)
const createAccessToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: "3h",
  });
};

// Refresh Token (long-lived)
const createRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: "30d",
  });
};

// Confirmation Token (1 hour)
const createConfirmationToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_CONFIRMATION_SECRET, {
    expiresIn: "1h",
  });
};

module.exports = {
  createAccessToken,
  createRefreshToken,
  createConfirmationToken,
};

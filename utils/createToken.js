const jwt = require("jsonwebtoken");

const createToken = (id, role) =>
  jwt.sign({ userId: id, userRole: role }, process.env.JWT_SECRET_KEY, {
    expiresIn: process.env.JWT_EXPIRE_TIME,
  });

module.exports = createToken;

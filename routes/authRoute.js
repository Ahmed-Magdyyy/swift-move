const express = require("express");

const {
  signup,
  login,
  forgetPassword,
  verifyPasswordResetCode,
  resetPassword,
  confirmEmail
} = require("../controllers/authController");


const Router = express.Router();

Router.post("/signup", signup);
Router.post("/login", login);
Router.post("/forgetPassword", forgetPassword);
Router.post("/verifyResetcode", verifyPasswordResetCode);
Router.put("/resetPassword", resetPassword);
Router.get("/confirm-email/:token", confirmEmail);

module.exports = Router;

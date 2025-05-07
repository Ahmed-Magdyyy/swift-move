const express = require("express");

const {
  signup,
  login,
  forgetPassword,
  verifyPasswordResetCode,
  resetPassword,
  confirmEmail,
  loginByGoogle
} = require("../controllers/authController");
const { cloudUpload } = require("../utils/Cloudinary/cloudUpload");

const userValidation = require('../Validation/user.validation');
const isValid = require("../middlewares/validatorMiddleware");



const Router = express.Router();

Router.post("/signup",cloudUpload({}).single("image"),isValid(userValidation.signUp), signup);
Router.post("/login", login);
Router.post("/forgetPassword", forgetPassword);
Router.post("/verifyResetcode", verifyPasswordResetCode);
Router.put("/resetPassword", resetPassword);
Router.get("/confirm-email/:token", confirmEmail);
Router.post("/google-login",loginByGoogle)

module.exports = Router;

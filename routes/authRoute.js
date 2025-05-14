const express = require("express");

const {
  signupValidator,
  loginValidator,
  forgetPasswordValidator,
  googleLoginValidator,
  resendConfirmationValidator,
  resetPasswordValidator,
  verifyResetCodeValidator,
} = require("../Validation/authValidator");

const {
  signup,
  login,
  logout,
  forgetPassword,
  verifyPasswordResetCode,
  resetPassword,
  confirmEmail,
  loginByGoogle,
  resendConfirmationEmail,
  refreshToken,
  protect,
} = require("../controllers/authController");
const { cloudUpload } = require("../utils/Cloudinary/cloudUpload");

const Router = express.Router();

Router.post(
  "/signup",
  cloudUpload({}).single("image"),
  signupValidator,
  signup
);
Router.post("/login", loginValidator, login);
Router.post("/forgetPassword", forgetPasswordValidator, forgetPassword);
Router.post(
  "/verifyResetcode",
  verifyResetCodeValidator,
  verifyPasswordResetCode
);
Router.put("/resetPassword", resetPasswordValidator, resetPassword);
Router.get("/confirm-email/:token", confirmEmail);
Router.post(
  "/resend-confirmation",
  resendConfirmationValidator,
  resendConfirmationEmail
);
Router.post("/refresh-token", refreshToken);
Router.post("/google-login", googleLoginValidator, loginByGoogle);

Router.use(protect);

Router.get("/logout", logout);

module.exports = Router;

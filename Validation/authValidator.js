const { check } = require("express-validator");
const validatorMiddleware = require("../middlewares/validatorMiddleware");
// const userModel = require("../../models/userModel");
const { roles, providers } = require("../utils/Constant/enum");

exports.signupValidator = [
  check("name")
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 3 })
    .withMessage("Name must be at least 3 characters")
    ,

  check("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email address")
    ,

  check("phone")
    .notEmpty()
    .withMessage("Phone is required")
    .matches(/^(\+201|01)[0-2,5]{1}[0-9]{8}$/)
    .withMessage("Invalid Egyptian phone number"),

  check("provider")
    .optional()
    .isIn(Object.values(providers))
    .withMessage(`Provider must be one of: ${Object.values(providers).join(', ')}`),

  check("password")
    .if((value, { req }) => req.body.provider === providers.SYSTEM)
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{6,}$/)
    .withMessage("Password must contain uppercase, lowercase, and number")
    .custom((value, { req }) => {
      if (value !== req.body.cPassword) {
        throw new Error("Password confirmation does not match");
      }
      return true;
    }),

  check("cPassword")
    .if((value, { req }) => req.body.provider === providers.SYSTEM)
    .notEmpty()
    .withMessage("Confirmation password is required"),

//   check("image")
//     .optional()
//     .custom((value) => {
//       if (!value.startsWith("data:image/")) {
//         throw new Error("Invalid image format");
//       }
//       const maxSize = 5 * 1024 * 1024; // 5MB
//       const buffer = Buffer.from(value.split(",")[1], "base64");
//       if (buffer.length > maxSize) {
//         throw new Error("Image exceeds 5MB limit");
//       }
//       return true;
//     }),

  check("role")
    .optional()
    .isIn(Object.values(roles))
    .withMessage(`Role must be one of: ${Object.values(roles).join(', ')}`),

  validatorMiddleware,
];

exports.loginValidator = [
  check("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email address"),

  check("password")
    .notEmpty()
    .withMessage("Password is required"),

  validatorMiddleware,
];

exports.forgetPasswordValidator = [
  check("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email address"),

  validatorMiddleware,
];

exports.verifyResetCodeValidator = [
  check("resetCode")
    .notEmpty()
    .withMessage("Reset code is required")
    .isLength({ min: 6, max: 6 })
    .withMessage("Reset code must be 6 digits"),

  validatorMiddleware,
];

exports.resetPasswordValidator = [
  check("newPassword")
    .notEmpty()
    .withMessage("New password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{6,}$/)
    .withMessage("Password must contain uppercase, lowercase, and number")
    .custom((value, { req }) => {
      if (value !== req.body.cNewPassword) {
        throw new Error("Password confirmation does not match");
      }
      return true;
    }),

  check("cNewPassword")
    .notEmpty()
    .withMessage("Confirmation password is required"),

  validatorMiddleware,
];

exports.resendConfirmationValidator = [
  check("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email address"),

  validatorMiddleware,
];

exports.googleLoginValidator = [
  check("idToken")
    .notEmpty()
    .withMessage("Google ID token is required"),

  validatorMiddleware,
];
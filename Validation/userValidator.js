const { check } = require("express-validator");
const validatorMiddleware = require("../middlewares/validatorMiddleware");
const { roles, providers, enabledControls } = require("../utils/Constant/enum");

exports.createUserValidator = [
  check("name")
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 3 })
    .withMessage("Name must be at least 3 characters"),
  check("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email address"),
  check("phone")
    .notEmpty()
    .withMessage("Phone is required")
    .matches(/^(\+201|01)[0-2,5]{1}[0-9]{8}$/)
    .withMessage("Invalid Egyptian phone number"),

  check("provider")
    .optional()
    .isIn(Object.values(providers))
    .withMessage(
      `Provider must be one of: ${Object.values(providers).join(", ")}`
    ),

  check("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{6,}$/)
    .withMessage("Password must contain uppercase, lowercase, and number"),

  check("cPassword")
    .notEmpty()
    .withMessage("Confirmation password is required")
    .custom((vlaue, { req }) => {
      if (vlaue !== req.body.password) {
        throw new Error("Confirmation password does not match password");
      }
      return true;
    }),

  check("role")
    .optional()
    .isIn(Object.values(roles))
    .withMessage(`Role must be one of: ${Object.values(roles).join(", ")}`),

  check("enabledControls")
    .optional()
    .isIn(Object.values(enabledControls))
    .withMessage(
      `Role must be one of: ${Object.values(enabledControls).join(", ")}`
    ),

  validatorMiddleware,
];

exports.updateUserValidator = [
  check("name")
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 3 })
    .withMessage("Name must be at least 3 characters"),

  check("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email address"),

  check("phone")
    .notEmpty()
    .withMessage("Phone is required")
    .matches(/^(\+201|01)[0-2,5]{1}[0-9]{8}$/)
    .withMessage("Invalid Egyptian phone number"),

  check("role")
    .notEmpty()
    .withMessage("role is required")
    .isIn(Object.values(roles))
    .withMessage(`Role must be one of: ${Object.values(roles).join(", ")}`),

  check("enabledControls")
    .notEmpty()
    .withMessage("enabledControls is required")
    .isArray()
    .withMessage("enabledControls must be an array")
    .custom((value, { req }) => {
      if (req.body.role === roles.ADMIN) {
        if (value && value.length === 0) {
          throw new Error(
            "At least one control must be enabled for admin users"
          );
        }
        return true;
      } else {
        if (value.length > 0) {
          throw new Error("enabledControls must be empty for non-admin roles");
        }
        return true;
      }
    }),
  check("active")
    .notEmpty()
    .withMessage("active field is required")
    .isBoolean()
    .withMessage("active field but be Boolean"),

  validatorMiddleware,
];

exports.updateUserPasswordValidator = [
  check("password")
    .notEmpty()
    .withMessage("Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{6,}$/)
    .withMessage("Password must contain uppercase, lowercase, and number"),

  check("cPassword")
    .notEmpty()
    .withMessage("Confirmation password is required")
    .custom((vlaue, { req }) => {
      if (vlaue !== req.body.password) {
        throw new Error("Confirmation password does not match password");
      }
      return true;
    }),

  validatorMiddleware,
];

exports.updateLoggedInUserPassword = [
  check("newPassword")
    .notEmpty()
    .withMessage("new Password is required")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{6,}$/)
    .withMessage("Password must contain uppercase, lowercase, and number"),

  check("cNewPassword")
    .notEmpty()
    .withMessage("Confirmation password is required")
    .custom((vlaue, { req }) => {
      if (vlaue !== req.body.newPassword) {
        throw new Error("Confirmation password does not match password");
      }
      return true;
    }),

  validatorMiddleware,
];

exports.updateLoggedInUserData = [
  check("name")
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ min: 3 })
    .withMessage("Name must be at least 3 characters"),
  check("email")
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Invalid email address"),
  check("phone")
    .notEmpty()
    .withMessage("Phone is required")
    .matches(/^(\+201|01)[0-2,5]{1}[0-9]{8}$/)
    .withMessage("Invalid Egyptian phone number"),

  validatorMiddleware,
];
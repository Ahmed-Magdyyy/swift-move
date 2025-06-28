const { check, body } = require("express-validator");
const validatorMiddleware = require("../middlewares/validatorMiddleware");
const { vehicleType, driverStatus } = require("../utils/Constant/enum");
const Move = require("../models/moveModel");
const ApiError = require("../utils/ApiError");

exports.validateOnboarding = [
    check("vehicle.type")
        .notEmpty()
        .withMessage("Vehicle type is required")
        .isIn(Object.values(vehicleType))
        .withMessage(`Vehicle type must be one of: ${Object.values(vehicleType).join(", ")}`),
    check("vehicle.model")
        .optional()
        .isString()
        .withMessage("Vehicle model must be a string"),
    check("vehicle.color")
        .optional()
        .isString()
        .withMessage("Vehicle color must be a string"),
    check("vehicle.licensePlate")
        .optional()
        .isString()
        .withMessage("Vehicle license plate must be a string"),
    validatorMiddleware,
];

exports.validateUpdateProfile = [
    check("vehicleType")
        .notEmpty()
        .withMessage("Vehicle type is required")
        .isIn(Object.values(vehicleType))
        .withMessage(`Vehicle type must be one of: ${Object.values(vehicleType).join(", ")}`),
    check("vehicleDetails.model")
        .optional()
        .isString()
        .withMessage("Vehicle model must be a string"),
    check("vehicleDetails.color")
        .optional()
        .isString()
        .withMessage("Vehicle color must be a string"),
    check("vehicleDetails.licensePlate")
        .optional()
        .isString()
        .withMessage("Vehicle license plate must be a string"),
    validatorMiddleware,
];



exports.validateUpdateAvailability = [
    check("isAvailable")
        .notEmpty()
        .withMessage("isAvailable is required")
        .isBoolean()
        .withMessage("isAvailable must be a boolean value (true or false)"),

    check("coordinates")
        .if(body("isAvailable").equals("true"))
        .notEmpty()
        .withMessage("Coordinates are required when setting isAvailable to true")
        .isArray({ min: 2, max: 2 }) 
        .withMessage("Coordinates must be an array of 2 numbers [longitude, latitude]")
        .custom((value) => {
            if (!value.every(coord => typeof coord === 'number')) {
                throw new Error("Coordinates must be numbers");
            }
            return true;
        }),

    validatorMiddleware,
];

exports.validateUpdateLocation = [
    check("coordinates")
        .notEmpty()
        .withMessage("Coordinates are required")
        .isArray({ min: 2, max: 2 })
        .withMessage("Coordinates must be an array of two numbers [longitude, latitude]")
        .custom((value) => {
            if (!value.every(coord => typeof coord === 'number')) {
                throw new Error("Coordinates must be numbers");
            }
            return true;
        }),
    validatorMiddleware,
];

exports.validateUpdateStatus = [
    check("status")
        .notEmpty()
        .withMessage("Status is required")
        .isIn(Object.values(driverStatus))
        .withMessage(`Status must be one of: ${Object.values(driverStatus).join(", ")}`),
    check("reason")
        .if(body("status").isIn(["rejected", "suspended"]))
        .notEmpty()
        .withMessage("Reason is required when status is rejected or suspended"),
    validatorMiddleware,
];

exports.validateRateDriver = [
    check("rate")
        .notEmpty()
        .withMessage("Rating is required")
        .isInt({ min: 1, max: 5 })
        .withMessage("Rating must be an integer between 1 and 5"),
    check("comment")
        .optional()
        .isString()
        .withMessage("Comment must be a string"),
    check("moveId")
        .notEmpty()
        .withMessage("Move ID is required")
        .isMongoId()
        .withMessage("Invalid Move ID format")
        .custom(async (moveId, { req }) => {
            const move = await Move.findById(moveId);
            if (!move) {
                throw new ApiError('Move not found', 404);
            }
            if (move.status !== 'delivered') {
                throw new ApiError('Cannot rate driver for a move that is not yet delivered.', 400);
            }
            return true;
        }),
    validatorMiddleware,
]; 
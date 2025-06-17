const { check } = require('express-validator');
const validatorMiddleware = require('../middlewares/validatorMiddleware');
const { moveStatus, vehicleType } = require("../utils/Constant/enum");

// Validation for getting a price estimate
exports.getPriceEstimateValidator = [
    check('pickup.address').notEmpty().withMessage('Pickup address is required'),
    check('pickup.coordinates').notEmpty().withMessage('Pickup coordinates are required').isObject().withMessage('Pickup coordinates are required'),
    check('pickup.coordinates.coordinates').notEmpty().withMessage('Pickup coordinates are required').isArray({ min: 2, max: 2 }).withMessage('Pickup coordinates must be an array of two numbers [longitude, latitude]'),
    check('delivery.address').notEmpty().withMessage('Delivery address is required'),
    check('delivery.coordinates').notEmpty().withMessage('Delivery coordinates are required').isObject().withMessage('Delivery coordinates are required'),
    check('delivery.coordinates.coordinates').notEmpty().withMessage('Delivery coordinates are required').isArray({ min: 2, max: 2 }).withMessage('Delivery coordinates must be an array of two numbers [longitude, latitude]'),
    check('vehicleType').notEmpty().withMessage('Vehicle type is required').isIn(Object.values(vehicleType)).withMessage('Invalid vehicle type'),
    validatorMiddleware
];

// Validation for creating a new move request
exports.createMoveRequestValidator = [
    ...exports.getPriceEstimateValidator.slice(0, -1), // Inherit and reuse rules from price estimate
    check('items').notEmpty().withMessage('At least one item is required for a move request.').isArray({ min: 1 }).withMessage('At least one item is required for a move request.'),
    check('items.*.name').notEmpty().withMessage('Item name is required').isString().withMessage('Item name must be a string').isLength({ min: 3 }).withMessage('Item name must be at least 3 characters long'),
    check('items.*.quantity').notEmpty().withMessage('Item quantity is required').isInt({ min: 1 }).withMessage('Item quantity must be a positive integer'),
    check('scheduledFor').optional().isISO8601().toDate().withMessage('Invalid schedule date format'),
    validatorMiddleware
];

// Validation for move status updates
exports.statusValidation = [
    check('status').isIn(Object.values(moveStatus))
        .withMessage('Invalid status'),
    validatorMiddleware
];

// Validation for move ratings (can be used in driverController)
exports.ratingValidation = [
    check('rate').isInt({ min: 1, max: 5 }).withMessage('Rating must be an integer between 1 and 5'),
    check('comment').optional().isString().withMessage('Comment must be a string'),
    check('moveId').isMongoId().withMessage('A valid move ID is required'),
    validatorMiddleware
];
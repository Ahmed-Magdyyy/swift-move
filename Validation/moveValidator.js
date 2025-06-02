const { check } = require('express-validator');
const validatorMiddleware = require('../middlewares/validatorMiddleware');
const { moveStatus,vehicleType } = require("../utils/Constant/enum");

// Validation for move creation and price estimation
exports.moveValidation = [
    check('pickup.address').notEmpty().withMessage('Pickup address is required'),
    check('pickup.coordinates.coordinates').isArray().withMessage('Invalid pickup coordinates'),
    check('delivery.address').notEmpty().withMessage('Delivery address is required'),
    check('delivery.coordinates.coordinates').isArray().withMessage('Invalid delivery coordinates'),
    check('items').isArray().withMessage('Items must be an array'),
    check('items.*.title').notEmpty().withMessage('Item title is required'),
    check('vehicleType').isIn(Object.values(vehicleType)).withMessage('Invalid vehicle type'),
    check('insurance.isSelected').isBoolean().withMessage('Insurance selection must be boolean'),
    check('insurance.type').optional().isIn(['basic', 'premium']).withMessage('Invalid insurance type'),
    validatorMiddleware
];

// Validation for move status updates
exports.statusValidation = [
    check('status').isIn(Object.values(moveStatus))
        .withMessage('Invalid status'),
    validatorMiddleware
];

// Validation for move ratings
exports.ratingValidation = [
    check('score').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
    check('comment').optional().isString().withMessage('Comment must be a string'),
    validatorMiddleware
]; 
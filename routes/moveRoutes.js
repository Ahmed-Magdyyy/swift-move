const express = require('express');
const router = express.Router();
const {
    getPriceEstimate,
    // createMove,
    getCustomerMoves,
    getDriverMoves,
    // getMoveById,
    // updateMoveStatus,
    // rateMove,
} = require('../controllers/moveController');
const { protect, allowedTo } = require('../controllers/authController');
const { moveValidation, statusValidation, ratingValidation } = require('../Validation/moveValidator');

// Routes
router.post('/estimate', protect, allowedTo('customer'), moveValidation, getPriceEstimate);
// router.post('/', protect, allowedTo('customer'), moveValidation, createMove);
router.get('/customer', protect, allowedTo('customer'), getCustomerMoves);
router.get('/driver', protect, allowedTo('driver'), getDriverMoves);
// router.get('/:id', protect, getMoveById);
// router.put('/:id/status', protect, allowedTo('driver'), statusValidation, updateMoveStatus);
// router.post('/:id/rate', protect, allowedTo('customer'), ratingValidation, rateMove);

module.exports = router; 
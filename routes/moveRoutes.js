const express = require('express');
const router = express.Router();
const {
    getPriceEstimate,
    createMoveRequest,
    getCustomerMoves,
    getDriverMoves,
    getMoveDetails,
    driverAcceptMove,
    driverRejectMove,
    updateMoveProgress,
    cancelMove,
} = require('../controllers/moveController');
const { protect, allowedTo } = require('../controllers/authController');
const { 
    getPriceEstimateValidator, 
    createMoveRequestValidator, 
    statusValidation, 
} = require('../Validation/moveValidator');

router.use(protect)

// Routes
router.post('/estimate', allowedTo('customer'), getPriceEstimateValidator, getPriceEstimate);
router.post('/', allowedTo('customer'), createMoveRequestValidator, createMoveRequest);
router.get('/customer', allowedTo('customer'), getCustomerMoves);
router.get('/driver', allowedTo('driver'), getDriverMoves);
router.get('/:id', allowedTo('customer', 'driver', 'admin'), getMoveDetails);
router.post('/:id/accept', allowedTo('driver'), driverAcceptMove);
router.post('/:id/reject', allowedTo('driver'), driverRejectMove);
router.put('/:id/progress', allowedTo('driver'), statusValidation, updateMoveProgress);
router.post('/:id/cancel', allowedTo('customer', 'driver', 'admin'), cancelMove); // Auth is handled in the service

module.exports = router;
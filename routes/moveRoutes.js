const express = require('express');
const router = express.Router();
const {
    getAllMoves,
    getPriceEstimate,
    createMoveRequest,
    getCustomerMoves,
    getDriverMoves,
    getMoveDetails,
    driverAcceptMove,
    driverRejectMove,
    updateMoveProgress,
    cancelMove
} = require('../controllers/moveController');
const { protect, allowedTo , enabledControls} = require('../controllers/authController');
const { 
    getPriceEstimateValidator, 
    createMoveRequestValidator, 
    statusValidation, 
} = require('../Validation/moveValidator');

router.use(protect)

// Routes
router.get('/', allowedTo('superAdmin','admin'), enabledControls("moves"), getAllMoves);
router.post('/estimate', allowedTo('customer'), getPriceEstimateValidator, getPriceEstimate);
router.post('/', allowedTo('customer'), createMoveRequestValidator, createMoveRequest);
router.get('/customer', allowedTo('customer'), getCustomerMoves);
router.get('/driver', allowedTo('driver'), getDriverMoves);
router.get('/:id', allowedTo('customer', 'driver', 'admin', 'superAdmin'), enabledControls("moves"), getMoveDetails);
router.put('/:id/accept', allowedTo('driver'), driverAcceptMove);
router.put('/:id/reject', allowedTo('driver'), driverRejectMove);
router.put('/:id/progress', allowedTo('driver'), statusValidation, updateMoveProgress);
router.post('/:id/cancel', allowedTo('customer', 'driver', 'admin','superAdmin'), cancelMove);

module.exports = router;
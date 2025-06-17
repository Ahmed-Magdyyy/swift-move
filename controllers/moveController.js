const asyncHandler = require('express-async-handler');
const pricingService = require('../services/pricingService');
const moveRequestService = require('../services/moveRequestService');
const ApiError = require('../utils/ApiError');

// @desc    Get price estimate for a move
// @route   POST /api/moves/estimate
// @access  Private (Customer)
const getPriceEstimate = asyncHandler(async (req, res, next) => {
    const { pickup, delivery, vehicleType } = req.body;

    try {
        const estimate = await pricingService.calculateMovePrice(
            pickup,
            delivery,
            vehicleType
        );
        res.status(200).json({
            status: 'success',
            data: estimate
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500, error));
    }
});

// @desc    Create a new move request
// @route   POST /api/moves
// @access  Private (Customer)
const createMoveRequest = asyncHandler(async (req, res, next) => {
    const {
        pickup,
        delivery,
        items,
        vehicleType,
        scheduledFor,
    } = req.body;
    const customerId = req.user._id;

    try {
        const result = await moveRequestService.initiateNewMove(customerId,{
            pickup,
            delivery,
            items,
            vehicleType,
            scheduledFor,
        });

        res.status(201).json({
            status: 'success',
            message: 'Move request created successfully. Searching for drivers.',
            data: result.move // Return the created move document
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});

// @desc    Get all moves for a customer
// @route   GET /api/moves/customer
// @access  Private (Customer)
const getCustomerMoves = asyncHandler(async (req, res, next) => {
    const customerId = req.user._id;
    try {
        const moves = await moveRequestService.getMovesForCustomer(customerId);
        res.status(200).json({
            status: 'success',
            count: moves.length,
            data: moves
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});

// @desc    Get all moves for a driver (e.g., assigned or completed)
// @route   GET /api/moves/driver
// @access  Private (Driver)
const getDriverMoves = asyncHandler(async (req, res, next) => {
    const driverId = req.user._id;
    try {
        const moves = await moveRequestService.getMovesForDriver(driverId);
        res.status(200).json({
            status: 'success',
            count: moves.length,
            data: moves
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});

// @desc    Get move by ID
// @route   GET /api/moves/:moveId
// @access  Private (Customer or assigned Driver or Admin)
const getMoveDetails = asyncHandler(async (req, res, next) => {
    const { id: moveId } = req.params;
    const { _id: userId, role: userRole } = req.user;

    try {
        const moveDetails = await moveRequestService.getMoveDetails(moveId, userId, userRole);
        res.status(200).json({
            status: 'success',
            data: moveDetails
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});

// @desc    Driver accepts a move request
// @route   POST /api/moves/:moveId/accept
// @access  Private (Driver)
const driverAcceptMove = asyncHandler(async (req, res, next) => {
    const { id: moveId } = req.params;
    const driverUserId = req.user._id;

    try {
        const result = await moveRequestService.acceptMoveRequest(moveId, driverUserId);
        res.status(200).json({
            status: 'success',
            message: 'Move accepted successfully.',
            data: result.move // The service returns the updated move document
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});

// @desc    Driver rejects a move request
// @route   POST /api/moves/:moveId/reject
// @access  Private (Driver)
const driverRejectMove = asyncHandler(async (req, res, next) => {
    const { id: moveId } = req.params;
    const driverUserId = req.user._id;
    const { reason } = req.body; // Optional reason for rejection

    try {
        await moveRequestService.handleDriverRejection(moveId, driverUserId, reason);
        res.status(200).json({
            status: 'success',
            message: 'Move rejection has been processed.'
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});

// @desc    Update move progress (status by driver)
// @route   PUT /api/moves/:moveId/progress
// @access  Private (Driver)
const updateMoveProgress = asyncHandler(async (req, res, next) => {
    const { id: moveId } = req.params;
    const { _id: driverUserId } = req.user;
    const { status, ...updateData } = req.body; // e.g., location, notes

    try {
        const updatedMove = await moveRequestService.updateMoveProgress(moveId, driverUserId, status, updateData);
        res.status(200).json({
            status: 'success',
            message: `Move progress updated to ${status}.`,
            data: updatedMove
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});

// @desc    Cancel a move
// @route   POST /api/moves/:moveId/cancel
// @access  Private (Customer, or Driver under certain conditions, or Admin)
const cancelMove = asyncHandler(async (req, res, next) => {
    const { id: moveId } = req.params;
    const { _id: userId, role: userRole } = req.user;
    const { reason } = req.body;

    try {
        const cancelledMove = await moveRequestService.cancelMoveRequest(moveId, userId, userRole, reason);
        res.status(200).json({
            status: 'success',
            message: 'Move has been successfully cancelled.',
            data: cancelledMove
        });
    } catch (error) {
        return next(new ApiError(error.message, error.statusCode || 500));
    }
});


module.exports = {
    getPriceEstimate,
    createMoveRequest,
    getCustomerMoves,
    getDriverMoves,
    getMoveDetails,
    driverAcceptMove,
    driverRejectMove,
    updateMoveProgress,
    cancelMove,
}; 
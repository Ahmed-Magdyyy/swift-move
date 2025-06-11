// controllers/moveController.js
const asyncHandler = require('express-async-handler');
// Service Imports
const pricingService = require('../services/pricingService');
const moveRequestService = require('../services/moveRequestService');
const Move = require('../models/moveModel'); // Temporarily for getCustomerMoves, getDriverMoves, getMoveDetails - ideally refactor to service
const ApiError = require('../utils/ApiError');

/**
 * @desc    Get price estimate for a move
 * @route   POST /api/moves/estimate
 * @access  Private (Customer)
 */
const getPriceEstimate = asyncHandler(async (req, res) => {
    const { pickup, delivery, vehicleType, items } = req.body;

    // Insurance is no longer part of pricing
    const estimate = await pricingService.calculateMovePrice(
        pickup,
        delivery,
        vehicleType,
        items
    );
    res.json(estimate);
});

/**
 * @desc    Create a new move request
 * @route   POST /api/moves
 * @access  Private (Customer)
 */
const createMoveRequest = asyncHandler(async (req, res) => {
    const {
        pickup,
        delivery,
        items,
        vehicleType,
        scheduledFor,
        notes, // Optional: any customer notes
    } = req.body;
    const customerId = req.user._id;

    const move = await moveRequestService.initiateNewMove({
        customerId,
        pickup,
        delivery,
        items,
        vehicleType,
        scheduledFor,
        notes,
    });

    res.status(201).json(move);
});

/**
 * @desc    Get all moves for a customer
 * @route   GET /api/moves/customer
 * @access  Private (Customer)
 */
const getCustomerMoves = asyncHandler(async (req, res) => {
    // TODO: Consider moving this logic to moveRequestService for consistency
    const moves = await Move.find({ customer: req.user._id })
        .sort({ createdAt: -1 })
        .lean(); // Use .lean() for faster queries if not modifying
    res.json(moves);
});

/**
 * @desc    Get all moves for a driver (e.g., assigned or completed)
 * @route   GET /api/moves/driver
 * @access  Private (Driver)
 */
const getDriverMoves = asyncHandler(async (req, res) => {
    // TODO: Consider moving this logic to moveRequestService for consistency
    // This might need more complex logic based on move status (e.g., 'accepted', 'in_transit', 'delivered' by this driver)
    const moves = await Move.find({ driver: req.user._id })
        .sort({ createdAt: -1 })
        .lean();
    res.json(moves);
});

/**
 * @desc    Get move by ID
 * @route   GET /api/moves/:moveId
 * @access  Private (Customer or assigned Driver or Admin)
 */
const getMoveDetails = asyncHandler(async (req, res) => {
    const { moveId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    // TODO: Move authorization logic into the service or a dedicated authorization middleware/service
    const move = await Move.findById(moveId)
        .populate('customer', 'name email phone') // Adjust fields as needed
        .populate('driver', 'name email phone vehicleDetails') // Adjust fields as needed
        .lean();

    if (!move) {
        throw new ApiError(404, 'Move not found');
    }

    const isCustomer = move.customer._id.toString() === userId.toString();
    const isDriver = move.driver && move.driver._id.toString() === userId.toString();
    const isAdmin = userRole === 'admin';

    if (!isCustomer && !isDriver && !isAdmin) {
        throw new ApiError(403, 'Not authorized to view this move');
    }

    res.json(move);
});

/**
 * @desc    Driver accepts a move request
 * @route   POST /api/moves/:moveId/accept
 * @access  Private (Driver)
 */
const driverAcceptMove = asyncHandler(async (req, res) => {
    const { moveId } = req.params;
    const driverId = req.user._id; // Assuming driver's ID is in req.user

    const result = await moveRequestService.acceptMoveRequest(moveId, driverId);
    res.json(result);
});

/**
 * @desc    Driver rejects a move request
 * @route   POST /api/moves/:moveId/reject
 * @access  Private (Driver)
 */
const driverRejectMove = asyncHandler(async (req, res) => {
    const { moveId } = req.params;
    const driverId = req.user._id;
    const { reason } = req.body; // Optional reason for rejection

    const result = await moveRequestService.handleDriverRejection(moveId, driverId, reason);
    res.json(result);
});

/**
 * @desc    Update move progress (status by driver)
 * @route   PUT /api/moves/:moveId/progress
 * @access  Private (Driver)
 */
const updateMoveProgress = asyncHandler(async (req, res) => {
    const { moveId } = req.params;
    const driverId = req.user._id;
    const { status, location } = req.body; // `location` might be current driver location for verification

    if (!status) {
        throw new ApiError(400, 'Status is required');
    }

    const updatedMove = await moveRequestService.updateMoveProgress(moveId, driverId, status, location);
    res.json(updatedMove);
});


/**
 * @desc    Cancel a move
 * @route   POST /api/moves/:moveId/cancel
 * @access  Private (Customer, or Driver under certain conditions, or Admin)
 */
const cancelMove = asyncHandler(async (req, res) => {
    const { moveId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;
    const { reason } = req.body; // Optional reason for cancellation

    const result = await moveRequestService.cancelMove(moveId, userId, userRole, reason);
    res.json(result);
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
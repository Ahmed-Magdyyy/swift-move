const Move = require('../models/moveModel');
const asyncHandler = require('express-async-handler');
const { validationResult } = require('express-validator');
const pricingService = require('../services/pricingService');
const googleMapsService = require('../services/googleMapsService');
const trackingService = require('../services/trackingService');

// @desc    Get price estimate for a move
// @route   POST /api/moves/estimate
// @access  Private (Customer)
const getPriceEstimate = asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400);
        throw new Error(errors.array()[0].msg);
    }

    const { pickup, delivery, vehicleType, items, insurance } = req.body;

    const estimate = await pricingService.calculateMovePrice(
        pickup,
        delivery,
        vehicleType,
        items,
        insurance
    );

    res.json(estimate);
});

// @desc    Create a new move request
// @route   POST /api/moves
// @access  Private (Customer)
const createMove = asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400);
        throw new Error(errors.array()[0].msg);
    }

    const {
        pickup,
        delivery,
        items,
        vehicleType,
        scheduledFor,
        insurance
    } = req.body;

    // Calculate pricing
    const pricing = await pricingService.calculateMovePrice(
        pickup,
        delivery,
        vehicleType,
        items,
        insurance
    );

    const move = await Move.create({
        customer: req.user._id,
        pickup,
        delivery,
        items,
        vehicleType,
        scheduledFor,
        insurance,
        pricing: {
            basePrice: pricing.basePrice,
            distancePrice: pricing.distancePrice,
            insurancePrice: pricing.insurancePrice,
            totalPrice: pricing.totalPrice
        },
        estimatedTime: {
            pickup: Math.ceil(pricing.duration / 60), // convert to minutes
            delivery: Math.ceil(pricing.duration / 60)
        }
    });

    // Get nearby drivers
    const nearbyDrivers = await googleMapsService.getNearbyDrivers(
        pickup.coordinates.coordinates
    );

    // Emit move creation event to nearby drivers
    trackingService.io.to('drivers').emit('move:new', {
        moveId: move._id,
        pickup,
        delivery,
        pricing,
        nearbyDrivers: nearbyDrivers.drivers
    });

    res.status(201).json(move);
});

// @desc    Get all moves for a customer
// @route   GET /api/moves/customer
// @access  Private (Customer)
const getCustomerMoves = asyncHandler(async (req, res) => {
    const moves = await Move.find({ customer: req.user._id })
        .sort({ createdAt: -1 });
    res.json(moves);
});

// @desc    Get all moves for a driver
// @route   GET /api/moves/driver
// @access  Private (Driver)
const getDriverMoves = asyncHandler(async (req, res) => {
    const moves = await Move.find({ driver: req.user._id })
        .sort({ createdAt: -1 });
    res.json(moves);
});

// @desc    Get move by ID
// @route   GET /api/moves/:id
// @access  Private
const getMoveById = asyncHandler(async (req, res) => {
    const move = await Move.findById(req.params.id)
        .populate('customer', 'name email phone')
        .populate('driver', 'name email phone');

    if (!move) {
        res.status(404);
        throw new Error('Move not found');
    }

    // Check if user is authorized to view this move
    if (move.customer._id.toString() !== req.user._id.toString() && 
        move.driver?._id.toString() !== req.user._id.toString() &&
        req.user.role !== 'admin') {
        res.status(403);
        throw new Error('Not authorized to view this move');
    }

    res.json(move);
});

// @desc    Update move status
// @route   PUT /api/moves/:id/status
// @access  Private (Driver)
const updateMoveStatus = asyncHandler(async (req, res) => {
    const { status } = req.body;
    const move = await Move.findById(req.params.id);

    if (!move) {
        res.status(404);
        throw new Error('Move not found');
    }

    if (move.driver.toString() !== req.user._id.toString()) {
        res.status(403);
        throw new Error('Not authorized to update this move');
    }

    // Validate status transition
    const validTransitions = {
        'pending': ['accepted'],
        'accepted': ['picked_up'],
        'picked_up': ['in_transit'],
        'in_transit': ['delivered']
    };

    if (!validTransitions[move.status]?.includes(status)) {
        res.status(400);
        throw new Error('Invalid status transition');
    }

    move.status = status;
    
    // Update actual times
    if (status === 'picked_up') {
        move.actualTime.pickup = new Date();
    } else if (status === 'delivered') {
        move.actualTime.delivery = new Date();
    }

    await move.save();

    // Emit status update to all relevant parties
    await trackingService.emitMoveStatusUpdate(move._id, status);

    res.json(move);
});

// @desc    Rate a move
// @route   POST /api/moves/:id/rate
// @access  Private (Customer)
const rateMove = asyncHandler(async (req, res) => {
    const { score, comment } = req.body;
    const move = await Move.findById(req.params.id);

    if (!move) {
        res.status(404);
        throw new Error('Move not found');
    }

    if (move.customer.toString() !== req.user._id.toString()) {
        res.status(403);
        throw new Error('Not authorized to rate this move');
    }

    if (move.status !== 'delivered') {
        res.status(400);
        throw new Error('Can only rate completed moves');
    }

    move.rating = { score, comment };
    await move.save();
    res.json(move);
});

module.exports = {
    getPriceEstimate,
    createMove,
    getCustomerMoves,
    getDriverMoves,
    getMoveById,
    updateMoveStatus,
    rateMove
}; 
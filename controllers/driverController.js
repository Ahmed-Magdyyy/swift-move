const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const Driver = require('../models/driverModel');
const User = require('../models/userModel');
const { cloudinary } = require('../utils/Cloudinary/cloud');
const Move = require('../models/moveModel');
const { roles } = require('../utils/Constant/enum');
const trackingService = require('../services/trackingService');

// @desc    Get driver profile
// @route   GET /api/v1/drivers/profile
// @access  Private (Driver only)
exports.getDriverProfile = asyncHandler(async (req, res, next) => {
    const driver = await Driver.findOne({ user: req.user._id })
        .populate('user', 'name email phone');

    if (!driver) {
        return next(new ApiError('Driver profile not found', 404));
    }

    res.status(200).json({
        status: 'success',
        data: driver
    });
});

// @desc    Update driver profile
// @route   PUT /api/v1/drivers/profile
// @access  Private (Driver only)
exports.updateDriverProfile = asyncHandler(async (req, res, next) => {
    const { vehicleType, vehicleDetails } = req.body;
    
    const driver = await Driver.findOne({ user: req.user._id });

    if (!driver) {
        return next(new ApiError('Driver profile not found', 404));
    }

    let documents = [];
    if (req.files) {
        const uploadPromises = Object.keys(req.files).map(async (docType) => {
            const file = req.files[docType][0];
            const result = await cloudinary.uploader.upload(file.path, {
                folder: `Swift-Move/Drivers/${req.user._id}/Documents`
            });
            return {
                type: docType,
                url: result.secure_url,
                publicId: result.public_id
            };
        });

        documents = await Promise.all(uploadPromises);
    }

    const updatedDriver = await Driver.findOneAndUpdate(
        { user: req.user._id },
        {
            vehicleType,
            vehicleDetails,
            ...(documents.length > 0 && { documents })
        },
        { new: true, runValidators: true }
    );

    res.status(200).json({
        status: 'success',
        data: updatedDriver
    });
});

// @desc    Update driver location
// @route   PUT /api/v1/drivers/location
// @access  Private (Driver only)
exports.updateLocation = asyncHandler(async (req, res, next) => {
    const driver = await Driver.findOne({ user: req.user._id });

    if (!driver) {
        return next(new ApiError('Driver profile not found.', 404));
    }

    // Only allow location updates if isAvailable is true.
    if (!driver.isAvailable) {
        return next(new ApiError('Cannot update location while offline. Please go online first.', 403));
    }

    const { coordinates } = req.body;
    driver.currentLocation = {
        type: 'Point',
        coordinates
    };

    await driver.save();

    res.status(200).json({
        status: 'success',
        message: 'Location updated successfully.',
        data: driver.currentLocation
    });
});

// @desc    Update driver availability and location upon going online
// @route   PUT /api/v1/drivers/availability
// @access  Private (Driver only)
exports.updateAvailability = asyncHandler(async (req, res, next) => {
    const { isAvailable, coordinates } = req.body;

    const driver = await Driver.findOne({ user: req.user._id });

    if (!driver) {
        return next(new ApiError('Driver not found', 404));
    }

    if (driver.status !== 'accepted') {
        return next(new ApiError('Cannot update availability. Driver is not an accepted partner.', 400));
    }

    const updatedFields = { isAvailable };

    // If the driver is going ONLINE, we require a location and must check their real-time connection.
    if (isAvailable === true) {
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
            return next(new ApiError('Valid coordinates are required to go online.', 400));
        }

        // Heartbeat Check: Ensure a live socket connection exists.
        if (!trackingService.isUserConnected(req.user._id.toString())) {
            return next(new ApiError('Could not establish a real-time connection. Please check your internet and try again.', 400));
        }

        updatedFields.currentLocation = {
            type: 'Point',
            coordinates: [coordinates[0], coordinates[1]], // [longitude, latitude]
        };
    }

    const updatedDriver = await Driver.findByIdAndUpdate(driver._id, updatedFields, { new: true });

    res.status(200).json({
        status: 'success',
        message: `Driver is now ${isAvailable ? 'online' : 'offline'}.`,
        data: {
            isAvailable: updatedDriver.isAvailable,
            currentLocation: updatedDriver.currentLocation,
        },
    });
});

// @desc    Submit driver onboarding request
// @route   POST /api/v1/drivers/onboarding
// @access  Private (Driver only)
exports.submitOnboarding = asyncHandler(async (req, res, next) => {
    const { vehicle } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
        return next(new ApiError('User not found', 404));
    }

    // Check if driver profile already exists
    const existingDriver = await Driver.findOne({ user: req.user._id });
    if (existingDriver) {
        return next(new ApiError('Driver profile already exists', 400));
    }

    // Handle document uploads
    const documents = {};
    if (req.files) {
        const uploadPromises = Object.keys(req.files).map(async (docType) => {
            const file = req.files[docType][0];
            const result = await cloudinary.uploader.upload(file.path, {
                folder: `Swift-Move/Drivers/${req.user._id}/Documents`
            });
            return {
                type: docType,
                url: result.secure_url,
                publicId: result.public_id
            };
        });

        const uploadedDocs = await Promise.all(uploadPromises);
        uploadedDocs.forEach(doc => {
            documents[doc.type] = {
                url: doc.url,
                publicId: doc.publicId
            };
        });
    }

    const driver = await Driver.create({
        user: req.user._id,
        vehicle,
        documents,
        isAvailable: false,
        status: "pending",
        history: ["Driver submitted onboarding request"]
    });

    if (req.user.role === roles.CUSTOMER) {
        await User.updateOne({ _id: req.user._id }, { role: roles.DRIVER }, { new: true });
    }

    res.status(201).json({
        status: 'success',
        message: 'Onboarding request submitted successfully. Waiting for admin approval.',
        data: driver
    });
});



// @desc    Get all drivers (Admin only)
// @route   GET /api/v1/drivers
// @access  Private (Admin only)
exports.getAllDrivers = asyncHandler(async (req, res, next) => {

    let filter = {};
    const { page, limit, ...query } = req.query;

    Object.keys(query).forEach((key) => {
        if (typeof query[key] === "string") {
            filter[key] = { $regex: query[key], $options: "i" };
        } else {
            filter[key] = query[key];
        }
    });

    const totalDriversCount = await Driver.countDocuments(filter);

    let drivers;
    // Pagination logic
    const pageNum = page * 1 || 1;
    const limitNum = limit * 1 || 10;
    const skipNum = (pageNum - 1) * limitNum;
    const totalPages = Math.ceil(totalDriversCount / limitNum);

    drivers = await Driver
        .find(filter)
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 })
        .skip(skipNum)
        .limit(limitNum)

    res
        .status(200)
        .json({ totalPages, page: pageNum, results: drivers.length, data: drivers });
});

// @desc    Get driver (Admin only)
// @route   GET /api/v1/drivers/:id
// @access  Private (Admin only)
exports.getDriver = asyncHandler(async (req, res, next) => {
    const driver = await Driver.findById(req.params.id).populate('user');
    if (!driver) {
        return next(new ApiError('Driver not found', 404));
    }
    res.status(200).json({ data: driver });
});

// @desc    Update driver status (Admin only)
// @route   PUT /api/v1/drivers/:id/status
// @access  Private (Admin only)
exports.updateDriverStatus = asyncHandler(async (req, res, next) => {

    const { status, reason } = req.body;

    const driver = await Driver.findById(req.params.id).populate('user');
    if (!driver) {
        return next(new ApiError('Driver not found', 404));
    }

    if ( driver.status === status) {
        return next(new ApiError(`Driver status is already ${status}`, 400));
    }

    driver.status = status;
    if (status === "accepted" || status === "rejected") {
        driver.history.push(`Account status changed to ${status}. ${status === "accepted" ? "Admins verified the driver profile and approved your request" : `Admins rejected your request due to ${reason}`}`);
    } else if (status === "suspended") {
        driver.history.push(`Account status changed to ${status}. Due to ${reason}`);
    }

    await driver.save();

    res.status(200).json({
        status: 'success',
        data: driver
    });
});

// @desc    Delete driver account (Admin only)
// @route   DELETE /api/v1/drivers/:id
// @access  Private (Admin only)
exports.deleteDriver = asyncHandler(async (req, res, next) => {
    const driver = await Driver.findById(req.params.id);

    if (!driver) {
        return next(new ApiError('Driver not found', 404));
    }

    // Delete driver's documents from Cloudinary
    if (driver.documents && driver.documents.length > 0) {
        const deletePromises = driver.documents.map(doc =>
            cloudinary.uploader.destroy(doc.publicId)
        );
        await Promise.all(deletePromises);
    }

    await driver.deleteOne();

    res.status(204).json({
        status: 'success',
        data: null
    });
}); 



// @desc    Rate driver (Customer only)
// @route   POST /api/v1/drivers/:id/rate
// @access  Private (Customer only)
exports.rateDriver = asyncHandler(async (req, res, next) => {
    const { id: driverId } = req.params;
    const { rate, comment, moveId } = req.body;
    const customerId = req.user._id;

    if (!rate || typeof rate !== 'number' || rate < 1 || rate > 5 || !Number.isInteger(rate)) {
        return next(new ApiError('Rating must be an integer between 1 and 5.', 400));
    }
    if (!moveId) {
        return next(new ApiError('Move ID is required to rate a driver.', 400));
    }

    const move = await Move.findById(moveId);
    if (!move) {
        return next(new ApiError('Move not found.', 404));
    }
    if (move.status !== 'delivered') {
        return next(new ApiError('Cannot rate driver for a move that is not yet delivered.', 400));
    }
    if (move.customer.toString() !== customerId.toString()) {
        return next(new ApiError('You are not authorized to rate the driver for this move.', 403));
    }
    if (!move.driver || move.driver.toString() !== driverId) {
        return next(new ApiError('This driver was not assigned to the specified move.', 400));
    }

    const driver = await Driver.findOne({ user: driverId });
    if (!driver) {
        return next(new ApiError('Driver not found.', 404));
    }

    const existingReview = driver.rating.reviews.find(
        r => r.moveId && r.moveId.toString() === moveId.toString() && r.customerId.toString() === customerId.toString()
    );

    if (existingReview) {
        return next(new ApiError('You have already rated this driver for this move.', 400));
    }

    driver.rating.reviews.push({
        customerId: customerId,
        moveId: moveId,
        rating: rate,
        comment: comment || '',
    });

    driver.rating.count = driver.rating.reviews.length;
    if (driver.rating.count > 0) {
        const totalRatingSum = driver.rating.reviews.reduce((acc, curr) => acc + curr.rating, 0);
        driver.rating.average = parseFloat((totalRatingSum / driver.rating.count).toFixed(1));
    } else {
        driver.rating.average = 0;
    }

    await driver.save();

    res.status(200).json({
        status: 'success',
        message: 'Driver rated successfully.',  
        data: {
            averageRating: driver.rating.average,
            ratingCount: driver.rating.count,
            newReview: driver.rating.reviews[driver.rating.reviews.length -1]
        }
    });
});
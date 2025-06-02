const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const Driver = require('../models/driverModel');
const User = require('../models/userModel');
const { cloudinary } = require('../utils/Cloudinary/cloud');
const sendEmail = require('../utils/Email/sendEmails');

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
    
    // Handle document uploads if provided
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

    const driver = await Driver.findOneAndUpdate(
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
        data: driver
    });
});

// @desc    Update driver location
// @route   PUT /api/v1/drivers/location
// @access  Private (Driver only)
exports.updateLocation = asyncHandler(async (req, res, next) => {
    const { coordinates } = req.body;
    
    const driver = await Driver.findOneAndUpdate(
        { user: req.user._id },
        {
            currentLocation: {
                type: 'Point',
                coordinates
            }
        },
        { new: true }
    );

    res.status(200).json({
        status: 'success',
        data: driver
    });
});

// @desc    Update driver availability
// @route   PUT /api/v1/drivers/availability
// @access  Private (Driver only)
exports.updateAvailability = asyncHandler(async (req, res, next) => {
    const { isAvailable } = req.body;
    
    const driver = await Driver.findOneAndUpdate(
        { user: req.user._id },
        { isAvailable },
        { new: true }
    );

    res.status(200).json({
        status: 'success',
        data: driver
    });
});

// @desc    Get driver earnings
// @route   GET /api/v1/drivers/earnings
// @access  Private (Driver only)
exports.getEarnings = asyncHandler(async (req, res, next) => {
    const driver = await Driver.findOne({ user: req.user._id })
        .populate({
            path: 'completedMoves',
            select: 'price status completedAt'
        });

    const earnings = {
        total: driver.completedMoves.reduce((sum, move) => sum + move.price, 0),
        moves: driver.completedMoves
    };

    res.status(200).json({
        status: 'success',
        data: earnings
    });
});

// @desc    Get nearby drivers
// @route   GET /api/v1/drivers/nearby
// @access  Private (Admin only)
exports.getNearbyDrivers = asyncHandler(async (req, res, next) => {
    const { longitude, latitude, maxDistance = 5000 } = req.query;

    const drivers = await Driver.find({
        isAvailable: true,
        currentLocation: {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: [parseFloat(longitude), parseFloat(latitude)]
                },
                $maxDistance: parseInt(maxDistance)
            }
        }
    })
    .populate('user', 'name phone')
    .select('currentLocation vehicleType rating');

    res.status(200).json({
        status: 'success',
        data: drivers
    });
});

// @desc    Get all drivers (Admin only)
// @route   GET /api/v1/drivers
// @access  Private (Admin only)
exports.getAllDrivers = asyncHandler(async (req, res, next) => {
    const drivers = await Driver.find({ role: 'driver' });
    
    res.status(200).json({
        status: 'success',
        results: drivers.length,
        data: drivers
    });
});

// @desc    Submit driver onboarding request
// @route   POST /api/v1/drivers/onboarding
// @access  Private (Driver only)
exports.submitOnboarding = asyncHandler(async (req, res, next) => {
    const { vehicle } = req.body;
    
    // Check if user exists and is not already a driver
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

    // Create driver profile with pending status
    const driver = await Driver.create({
        user: req.user._id,
        vehicle,
        documents,
        isAvailable: false,
        history:["Driver submitted onboarding request"]
    });

    // // Notify admins about new driver request
    // const admins = await User.find({ role: { $in: ['admin', 'superAdmin'] } });
    // const adminEmails = admins.map(admin => admin.email);

    // await sendEmail({
    //     email: adminEmails,
    //     subject: 'New Driver Onboarding Request',
    //     html: `
    //         <h1>New Driver Onboarding Request</h1>
    //         <p>A new driver has submitted their onboarding request:</p>
    //         <ul>
    //             <li>Name: ${user.name}</li>
    //             <li>Email: ${user.email}</li>
    //             <li>Phone: ${user.phone}</li>
    //             <li>Vehicle: ${vehicle.type} ${vehicle.model}</li>
    //         </ul>
    //         <p>Please review their documents and approve/reject their request.</p>
    //     `
    // });

    res.status(201).json({
        status: 'success',
        message: 'Onboarding request submitted successfully. Waiting for admin approval.',
        data: driver
    });
});

// @desc    Get driver onboarding status
// @route   GET /api/v1/drivers/onboarding/status
// @access  Private (Driver only)
exports.getOnboardingStatus = asyncHandler(async (req, res, next) => {
    try {
        const driver = await Driver.findOne({ user: req.user._id });
    
    if (!driver) {
        return next(new ApiError("No driver onboarding request found", 404))
    }

    res.status(200).json({
        status: 'success',
        data: {
            hasSubmitted: true,
            status: driver.status,
            // profile: driver
        }
    });
    } catch (error) {
        return next(new ApiError("Fail to find driver onboarding request", 500))
        
    }
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

    driver.status = status;
    if(status === "accepted" || status === "rejected"){
        driver.history.push(`Account status changed to ${status}. ${status ==="accepted"? "Admins verified the driver profile and approved your request" : `Admins rejected your request due to ${reason}`}`);
    } else if(status === "suspended"){
        driver.history.push(`Account status changed to ${status}. Due to ${reason}`);
    }

    await driver.save();

    res.status(200).json({
        status: 'success',
        data: driver
    });
});

// @desc    Get all pending driver requests (Admin only)
// @route   GET /api/v1/drivers/pending
// @access  Private (Admin only)
exports.getPendingDrivers = asyncHandler(async (req, res, next) => {
    const drivers = await Driver.find({ account_status: 'pending' })
        .populate('user', 'name email phone');
    
    res.status(200).json({
        status: 'success',
        results: drivers.length,
        data: drivers
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

    await driver.remove();

    res.status(204).json({
        status: 'success',
        data: null
    });
}); 
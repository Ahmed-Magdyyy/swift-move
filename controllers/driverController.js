const asyncHandler = require("express-async-handler");

const ApiError = require("../utils/ApiError");
const Driver = require("../models/driverModel");
const { cloudinary } = require("../utils/Cloudinary/cloud");

const usersModel = require("../models/userModel");

// @desc    Submit driver's onboarding request
// @route   POST /api/v1/drivers/onboarding
// @access  Private (Driver only)
exports.submitOnboarding = asyncHandler(async (req, res, next) => {
  const { vehicle } = req.body;

  // Check if user exists and is not already a driver
  const user = await usersModel.findById(req.user._id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  if(user.role !== "driver"){
    return next(new ApiError("User is not a driver", 401));

  }

  // Check if driver profile already exists
  const existingDriver = await Driver.findOne({ driver_info: req.user._id });
  if (existingDriver) {
    return next(new ApiError("Driver profile already exists", 400));
  }

  // Handle document uploads
  const documents = {};
  if (req.files) {
    const uploadPromises = Object.keys(req.files).map(async (docType) => {
      const file = req.files[docType][0];
      const result = await cloudinary.uploader.upload(file.path, {
        folder: `Swift-Move/Drivers/${req.user._id}/Documents`,
      });
      return {
        type: docType,
        url: result.secure_url,
        publicId: result.public_id,
      };
    });

    const uploadedDocs = await Promise.all(uploadPromises);
    uploadedDocs.forEach((doc) => {
      documents[doc.type] = {
        url: doc.url,
        publicId: doc.publicId,
      };
    });
  }

  // Create driver profile with pending status
  const driver = await Driver.create({
    driver_info: req.user._id,
    vehicle,
    documents,
    isAvailable: false,
    history: [{ message: "Driver submitted onboarding request" }],
  });

  res.status(201).json({
    status: "success",
    message:
      "Onboarding request submitted successfully. Waiting for admin approval.",
    data: driver,
  });
});

// @desc    Get driver onboarding status
// @route   GET /api/v1/drivers/onboarding/status
// @access  Private (Driver only)
exports.getOnboardingStatus = asyncHandler(async (req, res, next) => {
  try {
    const driver = await Driver.findOne({ driver_info: req.user._id });

    if (!driver) {
      return next(new ApiError("No driver onboarding request found", 404));
    }

    res.status(200).json({
      status: "success",
      data: {
        hasSubmitted: true,
        status: driver.status,
        history: driver.history,
      },
    });
  } catch (error) {
    return next(new ApiError("Fail to find driver onboarding request", 500));
  }
});

// @desc    Toggle driver availability
// @route   PUT /api/v1/drivers/availability
// @access  Private (Driver only)
exports.updateAvailability = asyncHandler(async (req, res, next) => {
  const driver = await Driver.findOneAndUpdate(
    { driver_info: req.user._id },
    [{ $set: { isAvailable: { $not: "$isAvailable" } } }],
    {
      new: true,
      runValidators: true,
    }
  );

  if (!driver) {
    return next(new ApiError("Driver profile not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: {
      isAvailable: driver.isAvailable,
      updatedAt: driver.updatedAt,
    },
  });
});

// @desc    Get drivers onboarding requests
// @route   PUT /api/v1/drivers/onboarding
// @access  Private (Admin only)
exports.getOnboardings = asyncHandler(async (req, res, next) => {
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
  // Pagination logic
  const pageNum = page * 1 || 1;
  const limitNum = limit * 1 || 5;
  const skipNum = (pageNum - 1) * limitNum;
  const totalPages = Math.ceil(totalDriversCount / limitNum);

  const drivers = await Driver.find(filter)
    .sort({ createdAt: -1 })
    .skip(skipNum)
    .limit(limitNum);

  res
    .status(200)
    .json({ totalPages, page: pageNum, results: drivers.length, drivers });
});

// @desc    Update driver status (Admin only)
// @route   PUT /api/v1/drivers/:id/status
// @access  Private (Admin only)
exports.updateDriverStatus = asyncHandler(async (req, res, next) => {
  const { status, reason } = req.body;

  try {
    const driver = await Driver.findById(req.params.id).populate("driver_info");
    if (!driver) {
      return next(new ApiError("Driver not found", 404));
    }

    driver.status = status;
    if (status === "accepted" || status === "rejected") {
      driver.history.push({
        message: `Account status changed to ${status}. ${
          status === "accepted"
            ? "Admins verified the driver profile and approved your request"
            : `Admins rejected your request due to ${reason}`
        }`,
      });
    } else if (status === "suspended") {
      driver.history.push(
        `Account status changed to ${status}. Due to ${reason}`
      );
    }

    await driver.save();

    res.status(200).json({
      status: "success",
      data: driver,
    });
  } catch (error) {
    return next(new ApiError("Failed updating driver's status", 500, error));
  }
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
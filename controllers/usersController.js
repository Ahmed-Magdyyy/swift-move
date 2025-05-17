const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");

const usersModel = require("../models/userModel");
const blackListModel = require("../models/blackListModel");
const { cloudinary } = require("../utils/Cloudinary/cloud");

const ApiError = require("../utils/ApiError");

//----- Admin Routes -----

exports.getUsers = asyncHandler(async (req, res, next) => {
  let filter = {};
  const { page, limit, ...query } = req.query;

  Object.keys(query).forEach((key) => {
    if (typeof query[key] === "string") {
      filter[key] = { $regex: query[key], $options: "i" };
    } else {
      filter[key] = query[key];
    }
  });

  if (!query.role) {
    filter.role = { $ne: "superAdmin" };
  }

  const totalUsersCount = await usersModel.countDocuments(filter);
  let users;
  // Pagination logic
  const pageNum = page * 1 || 1;
  const limitNum = limit * 1 || 5;
  const skipNum = (pageNum - 1) * limitNum;
  const totalPages = Math.ceil(totalUsersCount / limitNum);

  users = await usersModel
    .find(filter)
    .select("-refreshTokens")
    .sort({ createdAt: -1 })
    .skip(skipNum)
    .limit(limitNum);

  res
    .status(200)
    .json({ totalPages, page: pageNum, results: users.length, data: users });
});

exports.getUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  try {
    const user = await usersModel.findById(id).select(" -refreshTokens ");

    if (!user) {
      return next(new ApiError(`No user found for this id: ${id}`, 404));
    }

    res.status(200).json({ message: "Success", data: user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

exports.createUser = asyncHandler(async (req, res, next) => {
  if (req.body.role === "superAdmin") {
    return next(new ApiError(`Can't create a new super admin!`, 400));
  }
  const newDoc = await usersModel.create({
    ...req.body,
    account_status: "confirmed",
  });
  res.status(201).json({ message: "Success", data: newDoc });
});

exports.updateUser = asyncHandler(async (req, res, next) => {
  const { name, email, phone, role, enabledControls, active } = req.body;

  const user = await usersModel.findById(req.params.id);

  if (!user) {
    return next(new ApiError(`No User for this id:${req.params.id}`, 404));
  }

  const updatedUser = await usersModel.findByIdAndUpdate(
    req.params.id,
    {
      name,
      email,
      phone,
      role,
      enabledControls,
      active,
    },
    {
      new: true,
    }
  );

  if (!updatedUser) {
    return next(new ApiError(`No User for this id:${req.params.id}`, 404));
  }
  res.status(200).json({ data: updatedUser });
});

exports.updateUserPassword = asyncHandler(async (req, res, next) => {
  const { password } = req.body;

  const User = await usersModel.findByIdAndUpdate(
    req.params.id,
    {
      password: await bcrypt.hash(password, 12),
      passwordChangedAT: Date.now(),
    },
    {
      new: true,
    }
  );

  if (!User) {
    return next(new ApiError(`No User for this id:${req.params.id}`, 404));
  }
  res.status(200).json({ data: User });
});

exports.deleteUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const user = await usersModel.findById(id);

  if (!user) {
    return next(new ApiError(`No User for this id:${req.params.id}`, 404));
  }

  if (user.role === "superAdmin") {
    return next(new ApiError(`Super admin can't be deleted!`, 400));
  }

  const deletedUser = await usersModel.findByIdAndDelete(id);

  res.status(204).json({ message: "user deleted successfully", deletedUser });
});

//----- /Admin Routes -----

//----- User Routes -----

exports.getLoggedUser = asyncHandler(async (req, res, next) => {
  req.params.id = req.user._id;
  next();
});

exports.updateLoggedUserPassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  // 1) validation
  if (!currentPassword || !newPassword) {
    return next(new ApiError("Both passwords are required", 400));
  }

  // 2) Verify current password
  const user = await usersModel.findById(req.user._id).select("+password");
  if (!user) return next(new ApiError("User not found", 404));
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return next(new ApiError("Current password is incorrect", 401));
  }

  // 3) Update password
  user.password = newPassword;
  user.passwordChangedAT = Date.now();

  // 4) Invalidate all refresh tokens
  user.refreshTokens = [];
  await user.save();

  // 5) Blacklist current access token
  const currentAccessToken = req.headers.authorization?.split(" ")[1];
  if (currentAccessToken) {
    await blackListModel.create({
      token: currentAccessToken,
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });
  }

  // 6) Clear refresh token cookie
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
  });

  // 7) Send response forcing re-login
  res.status(200).json({
    status: "success",
    message: "Password updated successfully. Please login again.",
  });
});

exports.updateLoggedUserData = asyncHandler(async (req, res, next) => {
  const { name, email, phone } = req.body;
  const user = await usersModel.findById(req.user._id);

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Prepare updates
  const updates = {};
  if (name) updates.name = name;
  if (email) updates.email = email;
  if (phone) updates.phone = phone;

  let uploadedImage;
  let oldPublicId = user.image?.public_id;

  try {
    // Handle image upload
    if (req.file) {
      uploadedImage = await cloudinary.uploader.upload(req.file.path, {
        folder: "Swift-Move/Users/Profile",
      });

      updates.image = {
        secure_url: uploadedImage.secure_url,
        public_id: uploadedImage.public_id,
      };
    }

    // Save user with transaction-like approach
    const updatedUser = await usersModel
      .findByIdAndUpdate(req.user._id, updates, {
        new: true,
      })
      .select(" -refreshTokens ");

    // Cleanup old image after successful save
    if (oldPublicId && uploadedImage) {
      await cloudinary.uploader.destroy(oldPublicId);
    }

    res.status(200).json({ message: "Success", data: updatedUser });
  } catch (error) {
    // Cleanup uploaded image if save failed
    if (uploadedImage) {
      await cloudinary.uploader.destroy(uploadedImage.public_id);
    }

    return next(new ApiError("Failed to update user data", 500, error));
  }
});

exports.deleteLoggedUserData = asyncHandler(async (req, res, next) => {
  const userExist = await usersModel.findById(req.user._id);
  if (!userExist) {
    return next(new ApiError(messages.user.notFound, 404));
  }
  //delete image
  if (userExist.image?.public_id) {
    try {
      await cloudinary.uploader.destroy(userExist.image.public_id);
    } catch (cloudinaryError) {
      return next(new ApiError("Failed to delete image from Cloudinary", 500));
    }
  }
  let userDeleted = await usersModel.findByIdAndUpdate(req.user._id, {
    active: false,
  });
  if (!userDeleted) {
    return next(new ApiError(messages.user.failToDelete, 500));
  }
  res.status(204).json({ message: "Success", userDeleted });
});

//----- /User Routes -----

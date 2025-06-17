const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");

const usersModel = require("../models/userModel");
const ApiError = require("../utils/ApiError");
const createToken = require("../utils/createToken");

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
  const limitNum = limit * 1 || 10;
  const skipNum = (pageNum - 1) * limitNum;
  const totalPages = Math.ceil(totalUsersCount / limitNum);

  users = await usersModel
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skipNum)
    .limit(limitNum)

  res
    .status(200)
    .json({ totalPages, page: pageNum, results: users.length, data: users });
});

exports.getUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  try {
    const user = await usersModel.findById(id);

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
  //1) update user password based on user's payload (req.user._id)
  const { currentPassword, newPassword } = req.body;

  const user = await usersModel.findById(req.user._id);

  if ((await bcrypt.compare(currentPassword, user.password)) == true) {
    const Updateduser = await usersModel.findByIdAndUpdate(
      req.user._id,
      {
        password: await bcrypt.hash(newPassword, 12),
        passwordChangedAT: Date.now(),
      },
      {
        new: true,
      }
    );

    // 2) generate new token

    const token = createToken(user._id, user.role);
    res.status(200).json({ data: Updateduser, token });
  } else {
    return next(new ApiError("Current password is incorrect", 401));
  }
});

exports.updateLoggedUserData = asyncHandler(async (req, res, next) => {
  let { name, email, phone } = req.body;
  const userExist = await usersModel.findById(req.user._id);

  if (name) {
    userExist.name = name;
  }
  if (email) {
    userExist.email = email;
  }
  if (phone) {
    userExist.phone = phone;
  }
  let uploadedImage;
  if (req.file) {
    try {
      uploadedImage = await cloudinary.uploader.upload(req.file?.path, {
        public_id: userExist.image.public_id,
        overwrite: true,
      });

      userExist.image = {
        secure_url: uploadedImage.secure_url,
        public_id: uploadedImage.public_id,
      };
      req.failImage = {
        secure_url: uploadedImage.secure_url,
        public_id: uploadedImage.public_id,
      };
    } catch (uploadError) {
      return next(new AppError("Image upload failed", 500));
    }
  }

  const updatedUser = await userExist.save();

  if (!updatedUser) {
    if (uploadedImage) {
      uploadedImage = await cloudinary.uploader.destroy(
        uploadedImage.public_id
      );
    }
    return next(new ApiError("Fail To Update User Data", 500));
  }

  res.status(200).json({ data: updatedUser });
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

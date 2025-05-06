const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");

const usersModel = require("../models/userModel");
const ApiError = require("../utils/ApiError");
const createToken = require("../utils/createToken");

function deleteUploadedFile(file) {
  if (file) {
    const filePath = `${file.path}`;
    fs.unlink(filePath, (err) => {
      if (err) {
        console.error("Error deleting user image:", err);
      } else {
        console.log("User image deleted successfully:", filePath);
      }
    });
  }
}

const multerStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/users");
  },
  filename: function (req, file, cb) {
    const ext = file.mimetype.split("/")[1];
    const filename = `user-${uuidv4()}.${ext}`;
    cb(null, filename);
  },
});

const multerfilter = function (req, file, cb) {
  if (file.mimetype.startsWith("image")) {
    cb(null, true);
  } else {
    cb(new ApiError("only Images allowed", 400), false);
  }
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerfilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
}).single("image");

exports.uploadUserImage = (req, res, next) => {
  upload(req, res, function (err) {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(new ApiError("File size exceeds 5MB limit", 400));
        }
        return next(new errorResponse(err.message, 400));
      }

      if (req.file) deleteUploadedFile(req.file); // Delete the uploaded file
      return next(
        new ApiError(`An error occurred while uploading the file. ${err}`, 500)
      );
    }

    // Check if the uploaded file is not an image
    if (req.file && !req.file.mimetype.startsWith("image")) {
      // Delete the uploaded file
      deleteUploadedFile(req.file);
      return next(new ApiError("Only images are allowed", 400));
    }

    // Check if the uploaded file exceeds the size limit
    if (req.file && req.file.size > 5 * 1024 * 1024) {
      // Delete the uploaded file
      deleteUploadedFile(req.file);
      return next(new ApiError("Image file size exceeds 5 MB", 400));
    }

    // File uploaded successfully
    if (req.file) req.body.image = req.file.filename; // Set the image filename to req.body.image
    next();
  });
};

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
    .sort({ createdAt: -1 })
    .skip(skipNum)
    .limit(limitNum)
    .lean(); // Use lean to return plain JavaScript objects

  // users = users.map((user) => {
  //   if (user.image) {
  //     user.image = `${process.env.BASE_URL}/users/${user.image}`;
  //   }
  //   return user;
  // });

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
  const {
    name,
    email,
    phone,
    role,
    enabledControls,
    active,
  } = req.body;

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
  const user = await usersModel.findById(req.user._id);

  if (!user) {
    if (req.file) {
      const path = req.file.path;
      deleteUploadedFile({
        fieldname: "image",
        path,
      });
    }
    return next(new ApiError(`No user found for this id:${req.user._id}`, 404));
  }

  if (user.image !== null && req.file) {
    deleteUploadedFile({
      fieldname: "image",
      path: `uploads/users/${user.image}`,
    });
  }

  const updatedUser = await usersModel.findByIdAndUpdate(
    req.user._id,
    {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      image: req.file && req.file.filename,
    },
    { new: true }
  );

  res.status(200).json({ data: updatedUser });
});

exports.deleteLoggedUserData = asyncHandler(async (req, res, next) => {
  await usersModel.findByIdAndUpdate(req.user._id, { active: false });
  res.status(204).json({ message: "Success" });
});

//----- /User Routes -----

const crypto = require("crypto");
const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");

const jwt = require("jsonwebtoken");

const ApiError = require("../utils/ApiError");
const usersModel = require("../models/userModel");
const blackListModel = require("../models/blackListModel")
const sendEmail = require("../utils/Email/sendEmails");
const {
  createAccessToken,
  createRefreshToken,
  createConfirmationToken,
} = require("../utils/createToken");
const { verifyGoogle } = require("../utils/VerifyGoogle/verifyGoogle");
const { providers, accountStatus, roles } = require("../utils/Constant/enum");
const { cloudinary } = require("../utils/Cloudinary/cloud");
const {
  confirmEmailHtml,
  forgetPasswordEmailHTML,
} = require("../utils/Email/emailHtml");

exports.signup = asyncHandler(async (req, res, next) => {
  //get data from req
  let { name, email, phone, password, role } = req.body;

  //check exist
  const userExist = await usersModel.findOne({ email });
  if (userExist) {
    return next(new ApiError("User Already Exist", 409));
  }

  // upload Image to cloudinary
  let secure_url, public_id;

  if (req.file) {
    try {
      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        folder: "Swift-Move/Users/Profile",
      });
      secure_url = uploadResult.secure_url;
      public_id = uploadResult.public_id;
    } catch (err) {
      return next(new ApiError("Image upload failed", 500, err));
    }
  }

  try {
    // Create a new user
    const user = await usersModel.create({
      name,
      email,
      phone,
      password,
      role,
      image: req.file ? { secure_url, public_id } : {},
      account_status: "pending",
    });

    // Generate confirmation token
    const confirmationToken = createConfirmationToken(user._id);

    // send confirmation email
    let capitalizeFirlstLetterOfName =
      user.name.split(" ")[0].charAt(0).toUpperCase() +
      user.name.split(" ")[0].slice(1).toLocaleLowerCase();

    try {
      await sendEmail({
        email: user.email,
        subject: `${capitalizeFirlstLetterOfName}, Please confirm your account`,
        message: confirmEmailHtml(
          capitalizeFirlstLetterOfName,
          confirmationToken
        ),
      });
      console.log("Email sent");
    } catch (error) {
      console.log(error);
    }

    res.status(201).json({
      message: "User created. Please check your email for confirmation.",
      data: user,
      confirmationToken,
    });
  } catch (error) {
    await cloudinary.uploader.destroy(public_id);
    req.failImage = { secure_url, public_id };
    return next(new ApiError("Registration failed", 500, error));
  }
});

exports.confirmEmail = asyncHandler(async (req, res, next) => {
  const { token } = req.params;

  try {
    // Verify confirmation token
    const decoded = jwt.verify(token, process.env.JWT_CONFIRMATION_SECRET);

    // Check expiration
    if (Date.now() >= decoded.exp * 1000) {
      return next(new ApiError("Confirmation link expired", 401));
    }

    const user = await usersModel.findById(decoded.userId);
    if (!user) return next(new ApiError("User not found", 404));

    if (user.account_status === "confirmed") {
      return res.status(200).json({ message: "Email already confirmed" });
    }

    // Update user status
    user.account_status = "confirmed";

    await user.save();

    res.status(200).send("Account confirmed successfully. You can login now");
  } catch (error) {
    return next(new ApiError("Invalid confirmation token", 401));
  }
});

exports.resendConfirmationEmail = asyncHandler(async (req, res, next) => {
  const { email } = req.body;

  const user = await usersModel.findOne({ email });
  if (!user) return next(new ApiError("User not found", 404));

  if (user.account_status === "confirmed") {
    return next(new ApiError("Email already confirmed", 400));
  }

  // Generate new confirmation token
  const confirmationToken = createConfirmationToken(user._id);

  const capitalizeFirlstLetterOfName =
    user.name.split(" ")[0].charAt(0).toUpperCase() +
    user.name.split(" ")[0].slice(1).toLowerCase();

  await sendEmail({
    email: user.email,
    subject: `${capitalizeFirlstLetterOfName}, Please confirm your account`,
    html: confirmEmailHtml(capitalizeFirlstLetterOfName, confirmationToken),
  });

  res
    .status(200)
    .json({ message: "Confirmation email resent", confirmationToken });
});

exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  const user = await usersModel.findOne({ email }).select("+password");
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return next(new ApiError("Incorrect email or password", 401));
  }

  if (user.account_status !== "confirmed") {
    return next(new ApiError("Please confirm your email first", 401));
  }

  if (!user.active) {
    return next(
      new ApiError(
        "Account has been deactivated. Contact customer support",
        401
      )
    );
  }

  // Generate tokens
  const accessToken = createAccessToken(user._id, user.role);
  const refreshToken = createRefreshToken(user._id);

  // Store hashed refresh token
  const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
  user.refreshTokens.push({
    token: hashedRefreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  await user.save();

  // Set refresh token cookie
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    data: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      ...(user.role === roles.ADMIN && { enabledControls: user.enabledControls }),
      provider: user.provider,
      image: user.image, // Only include necessary fields
    },
    accessToken,
    accessTokenExpires: new Date(Date.now() + 3 * 60 * 60 * 1000),
  });
});

exports.refreshToken = asyncHandler(async (req, res, next) => {
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) return next(new ApiError("Unauthorized", 401));

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await usersModel.findById(decoded.userId);

    // Find matching token
    const tokenMatch = await Promise.all(
      user.refreshTokens.map(async (storedToken) => ({
        ...storedToken,
        match: await bcrypt.compare(refreshToken, storedToken.token),
      }))
    );

    const validToken = tokenMatch.find((t) => t.match);
    if (!validToken) return next(new ApiError("Invalid token", 401));

    // Generate new tokens
    const newAccessToken = createAccessToken(user._id, user.role);
    const newRefreshToken = createRefreshToken(user._id);

    // Update stored token
    user.refreshTokens = user.refreshTokens.filter(
      (t) => t.token !== validToken.token
    );
    user.refreshTokens.push({
      token: await bcrypt.hash(newRefreshToken, 10),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await user.save();

    // Set new cookie
    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      accessToken: newAccessToken,
      accessTokenExpires: new Date(Date.now() + 3 * 60 * 60 * 1000),
    });
  } catch (error) {
    return next(new ApiError("Invalid refresh token", 401));
  }
});

exports.protect = asyncHandler(async (req, res, next) => {
  // 1) Check for access token
  let accessToken;
  if (req.headers.authorization?.startsWith("Bearer")) {
    accessToken = req.headers.authorization.split(" ")[1];
  }

  if (!accessToken) {
    return next(new ApiError("Please login first", 401));
  }

  // 2) Verify token
  const decoded = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET);

  // 3) Check blacklist
  const blacklisted = await blackListModel.exists({ token: accessToken });
  if (blacklisted) {
    return next(new ApiError("Token revoked, please login again", 401));
  }

  // 4) Check user exists
  const currentUser = await usersModel.findById(decoded.userId);
  if (!currentUser) {
    return next(new ApiError("User no longer exists", 401));
  }

  // 5) Check password change
  if (currentUser.passwordChangedAT?.getTime() > decoded.iat * 1000) {
    return next(new ApiError("Password changed recently!", 401));
  }

  req.user = currentUser;
  next();
});

exports.allowedTo = (...roles) =>
  asyncHandler(async (req, res, next) => {

    console.log('====================================');
    console.log("req.user",req.user);
    console.log("roles",roles);
    console.log("req.user.role",req.user.role);
    console.log("roles.includes(req.user.role)",roles.includes(req.user.role));
    console.log('====================================');
    if (!roles.includes(req.user.role)) {
      return next(
        new ApiError("you are not allowed to access this route", 403)
      );
    }
    next();
  });

exports.enabledControls = (...scope) =>
  asyncHandler(async (req, res, next) => {
    if (
      req.user.role == roles.ADMIN &&
      !req.user.enabledControls.includes(scope)
    ) {
      return next(
        new ApiError(
          "You don't have the permission to access this. contact support to enable it.",
          403
        )
      );
    }
    next();
  });

exports.logout = asyncHandler(async (req, res, next) => {
  // 1) Get refresh token from cookie
  const refreshToken = req.cookies.refreshToken;
  if (!refreshToken) {
    return next(new ApiError("No active session to logout", 400));
  }

  // 2) Get access token from headers
  const accessToken = req.headers.authorization?.split(" ")[1];

  // 3) Get user from DB
  const user = await usersModel.findById(req.user._id);
  if (!user) {
    res.clearCookie("refreshToken");
    return next(new ApiError("User not found", 404));
  }

  // 4) Remove refresh token
  const tokensBefore = user.refreshTokens.length;
  user.refreshTokens = user.refreshTokens.filter(
    tokenDoc => !bcrypt.compareSync(refreshToken, tokenDoc.token)
  );
  
  if (user.refreshTokens.length < tokensBefore) {
    await user.save();
  }

  // 5) Blacklist access token
  if (accessToken) {
    try {
      const decoded = jwt.decode(accessToken);
      await blackListModel.create({
        token: accessToken,
        expiresAt: new Date(decoded.exp * 1000)
      });
    } catch (error) {
      return next(new ApiError("Error blacklisting token", 400, error))
    }
  }

  // 6) Clear cookie
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
  });

  res.status(200).json({
    status: "success",
    message: "Logged out successfully",
  });
});

exports.forgetPassword = asyncHandler(async (req, res, next) => {
  //1) Get user by email
  const user = await usersModel.findOne({ email: req.body.email });
  if (!user) {
    return next(
      new ApiError(`No user found for this email:${req.body.email}`, 404)
    );
  }

  //2) if user exists => Generate a random 6 digits code and save it hashed into DB
  const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
  const hashedResetCode = crypto
    .createHash("sha256")
    .update(resetCode)
    .digest("hex");

  // save hashed password reset code in DB
  user.passwordResetCode = hashedResetCode;

  // add hashed password reset code expiration time (10 min)
  user.passwordResetCodeExpire = Date.now() + 20 * 60 * 1000;
  user.passwordResetCodeVerified = false;

  await user.save();

  //3) send the reset code by email address
  let capitalizeFirlstLetterOfName =
    user.name.split(" ")[0].charAt(0).toUpperCase() +
    user.name.split(" ")[0].slice(1).toLocaleLowerCase();

  try {
    await sendEmail({
      email: user.email,
      subject: `${capitalizeFirlstLetterOfName}, here is your reset code`,
      message: forgetPasswordEmailHTML(capitalizeFirlstLetterOfName, resetCode),
    });
  } catch (error) {
    (user.passwordResetCode = undefined),
      (user.passwordResetCodeExpire = undefined);
    user.passwordResetCodeVerified = undefined;

    await user.save();
    console.log(error);
    return next(new ApiError("Sending email failed", 500));
  }

  res
    .status(200)
    .json({ message: "success", status: "reset code sent to email" });
});

exports.verifyPasswordResetCode = asyncHandler(async (req, res, next) => {
  // get user based on password reset code
  const hashedResetCode = crypto
    .createHash("sha256")
    .update(req.body.resetCode)
    .digest("hex");

  const user = await usersModel.findOne({
    passwordResetCode: hashedResetCode,
    passwordResetCodeExpire: { $gt: Date.now() },
  });
  if (!user) {
    return next(new ApiError("Reset code is invalid or expired"));
  }

  // reset code valid
  user.passwordResetCodeVerified = true;
  await user.save();

  res.status(200).json({ message: "success" });
});

exports.resetPassword = asyncHandler(async (req, res, next) => {
  // 1) Get user by email
  const user = await usersModel.findOne({ email: req.body.email });
  if (!user) {
    return next(
      new ApiError(`No user found with email ${req.body.email}`, 404)
    );
  }

  // 2) Check if reset code was verified
  if (!user.passwordResetCodeVerified) {
    return next(new ApiError("Reset code not verified", 400));
  }

  // 3) Update password and clear reset fields
  user.password = req.body.newPassword;
  user.passwordChangedAT = Date.now();
  user.passwordResetCode = undefined;
  user.passwordResetCodeExpire = undefined;
  user.passwordResetCodeVerified = undefined;

  // 4) Invalidate all previous refresh tokens
  user.refreshTokens = [];

  // 5) Generate new tokens
  const accessToken = createAccessToken(user._id, user.role);
  const refreshToken = createRefreshToken(user._id);

  // 6) Store new refresh token
  const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
  user.refreshTokens.push({
    token: hashedRefreshToken,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });

  await user.save();

  // 7) Set refresh token in cookie
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  // 8) Send response
  res.status(200).json({
    status: "success",
    accessToken,
    accessTokenExpires: new Date(Date.now() + 3 * 60 * 60 * 1000), // 3 hours
  });
});

//login by google
exports.loginByGoogle = asyncHandler(async (req, res, next) => {
  //get id token from req
  let { idToken } = req.body;
  //check token from google
  let { email, name } = await verifyGoogle(idToken);
  //check user exist
  let userExist = await usersModel.findOne({ email });

  if (userExist && userExist.provider !== providers.GOOGLE) {
    return next(
      new ApiError(
        `Email already registered with ${userExist.provider}. Please use ${userExist.provider} login.`,
        409
      )
    );
  }

  if (!userExist) {
    userExist = await usersModel.create({
      email,
      name,
      provider: providers.GOOGLE,
      account_status: accountStatus.CONFIRMED,
      phone: undefined,
    });
  }
  //generate token
  const accessToken = createToken(userExist._id, userExist.role);
  //send response
  return res.status(200).json({
    message: "User Login Successfully",
    success: true,
    access_token: accessToken,
  });
});

const ApiError = require("../utils/ApiError");
const { deleteImageCloud } = require("../utils/Cloudinary/cloud");

const handelJwtInvalidSignature = () =>
  new ApiError("Invalid token, Please login again", 401);

const handelJwtExpire = () =>
  new ApiError("Expired token, Please login again", 401);

const sendErrorForDev = (err, res) => {
  return res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

const sendErrorForprod = (err, res) => {
  return res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
  });
};

const globalError =async (err, req, res, next) => {
  // for cloudinary
  if( req.failImage){
     await deleteImageCloud( req.failImage.public_id)
  }
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";
  if (process.env.NODE_ENV === "development") {
    sendErrorForDev(err, res);
  } else {
    if (err.name === "JsonWebTokenError") err = handelJwtInvalidSignature();
    if (err.name === "TokenExpiredError") err = handelJwtExpire();
    sendErrorForprod(err, res);
  }
};

module.exports = globalError;

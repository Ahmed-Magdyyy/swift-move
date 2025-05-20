
const ApiError = require("../ApiError");



export const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100 , 
    handler:(req ,res ,next, options)=>{
    return next(new ApiError(options.message , options.statusCode))
  }
})
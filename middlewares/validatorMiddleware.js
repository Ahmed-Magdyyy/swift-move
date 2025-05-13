// const ApiError = require("../utils/ApiError");

//  const isValid = (schema)=>{
//   return (req,res,next)=>{
//       let data = {...req.body,...req.params,...req.query}
//       let{error}= schema.validate(data,{abortEarly:false})
//       if(error){
//           let errArr = [];
//           error.details.forEach((err) => {
//               errArr.push(err.message)
//           });
//           console.log(errArr);

//           return next(new ApiError(errArr,400))
//       }
//       next()
//   }

// }
// module.exports = validatorMiddleware;
// module.exports =isValid

// const ApiError = require("../utils/ApiError");

// const isValid = (schema) => {
//   return (req, res, next) => {
//     const data = {
//       ...req.body,
//       ...req.params,
//       ...req.query,
//     };

//     const { error } = schema.validate(data, {
//       abortEarly: false, // Collect all errors
//       allowUnknown: true, // Ignore unknown fields
//       stripUnknown: true, // Remove unknown fields
//     });

//     if (error) {
//       //Format errors
//       const formattedErrors = error.details.map((err) => ({
//         field: err.context.key,
//         message: err.message.replace(/"/g, ""), // Remove Joi quotes
//       }));
//       return next(
//         new ApiError(
//           "Validation Error", // message string
//           400, // status code
//           formattedErrors // errors array
//         )
//       );
//     }

//     //Sanitize request data
//     req.body = data.body || {};
//     req.params = data.params || {};
//     req.query = data.query || {};

//     next();
//   };
// };

// module.exports = isValid;


const { validationResult } = require("express-validator");

const validatorMiddleware = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.send({ errors: errors.array() });
  }
  next();
};

module.exports = validatorMiddleware;
const { validationResult } = require("express-validator");
const ApiError = require("../utils/ApiError");

const validatorMiddleware = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.send({ errors: errors.array() });
  }
  next();
};
 const isValid = (schema)=>{
  return (req,res,next)=>{
      let data = {...req.body,...req.params,...req.query}
      let{error}= schema.validate(data,{abortEarly:false})
      if(error){
          let errArr = [];
          error.details.forEach((err) => {
              errArr.push(err.message)
          });
          console.log(errArr);
          
          return next(new ApiError(errArr,400))
      }
      next()
  }

}
module.exports = validatorMiddleware;
module.exports =isValid

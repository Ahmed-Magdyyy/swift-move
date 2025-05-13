const joi = require("joi");
const { userFields } = require("../utils/GeneralFields/userFields");
const { providers } = require("../utils/Constant/enum");

//Sign Up
const signUp = joi
  .object({
    name: userFields.name.required(),
    email: userFields.email.required(),
    phone: userFields.phone.required(),
    provider: userFields.provider.default(providers.SYSTEM),
    password: userFields.password.when('provider', {
      is: providers.SYSTEM,
      then: joi.required(),
      otherwise: joi.forbidden()
    }),
    cPassword: userFields.cPassword.when('provider', {
      is: providers.SYSTEM,
      then: joi.required().label('Confirm Password'),
      otherwise: joi.forbidden()
    }),
    role: userFields.role.default("customer")
  }).with('password', 'cPassword')


//Log in
const login = joi.object({
  email: userFields.email.required(),
  password: userFields.password.required()
});

//Forget password
const forgetPassword = joi.object({
  email: userFields.email.required()
});

//Verify reset code
const verifyResetCode = joi.object({
  resetCode: joi.string().length(6).required()
});

//Reset password
const resetPassword = joi.object({
  newPassword: userFields.password.required(),
  cNewPassword: userFields.cPassword.required()
}).with('newPassword', 'cNewPassword');

//Resend confirmation email
const resendConfirmation = joi.object({
  email: userFields.email.required()
});

//Google login
const googleLogin = joi.object({
  idToken: joi.string().required()
});

module.exports = {
  signUp,
  login,
  forgetPassword,
  verifyResetCode,
  resetPassword,
  resendConfirmation,
  googleLogin
};

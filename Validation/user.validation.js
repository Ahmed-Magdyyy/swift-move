const joi = require("joi");
const { userFields } = require("../utils/GeneralFields/userFields");
const { providers } = require("../utils/Constant/enum");


//sign Up
const signUp = joi.object({
    name:userFields.name.required(),
    email:userFields.email.required(),
    phone:userFields.phone.optional(),
    provider:userFields.provider,
    password:userFields.password.when("provider",{
        is:providers.SYSTEM,
        then:joi.string().required(),
        otherwise:joi.string().optional()
    }),
    cPassword:userFields.cPassword.required(),
    role:userFields.role
}).required()
module.exports={
    signUp
}
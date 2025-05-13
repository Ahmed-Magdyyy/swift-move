const joi = require("joi")
const { roles, providers } = require("../Constant/enum")

// general validation patterns
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d]{6,}$/;
const egyptPhonePattern = /^(00201|\+201|01)[0-2,5]{1}[0-9]{8}$/;

const userFields = {
name: joi.string().min(3).max(50),
email:joi.string().email(),
phone: joi.string()
    .pattern(egyptPhonePattern)
    .message("Invalid Egyptian phone number format"),
password: joi.string()
    .pattern(passwordPattern)
    .message("Password must contain at least 6 characters, one uppercase, one lowercase, and one number"),
role:joi.valid(...Object.values(roles)).default(roles.CUSTOMER),
cPassword:joi.string().valid(joi.ref("password")),
provider: joi.string()
.valid(providers.SYSTEM, providers.GOOGLE)
}
module.exports={
    userFields
}
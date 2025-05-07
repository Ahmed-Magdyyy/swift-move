const joi = require("joi")
const { roles, providers } = require("../Constant/enum")

const userFields = {
name:joi.string(),
email:joi.string().email(),
phone:joi.string().pattern(new RegExp(/^(00201|\+201|01)[0-2,5]{1}[0-9]{8}$/)),
password:joi.string().pattern(new RegExp(/^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$/)),
role:joi.valid(...Object.values(roles)),
cPassword:joi.string().valid(joi.ref("password")),
provider: joi.string()
.valid(providers.SYSTEM, providers.GOOGLE)
}
module.exports={
    userFields
}
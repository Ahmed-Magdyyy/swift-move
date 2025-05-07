const roles ={
    CUSTOMER:"customer",
    DERIVER:"driver",
    ADMIN:"admin",
    SUPER_ADMIN:"superAdmin"
}
Object.freeze(roles)
const accountStatus = {
    PENDING:"pending",
    CONFIRMED:"confirmed"
}
Object.freeze(accountStatus)
//provider
const providers = {
    SYSTEM:"system",
    GOOGLE : "google"
}
Object.freeze(providers)
module.exports = {
    roles,
    accountStatus,
    providers
  };
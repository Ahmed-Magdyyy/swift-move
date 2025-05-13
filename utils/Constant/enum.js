const roles = {
  CUSTOMER: "customer",
  DRIVER: "driver",
  ADMIN: "admin",
  SUPER_ADMIN: "superAdmin",
};
const accountStatus = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
};
//provider
const providers = {
  SYSTEM: "system",
  GOOGLE: "google",
};

Object.freeze(roles);
Object.freeze(accountStatus);
Object.freeze(providers);

module.exports = {
  roles,
  accountStatus,
  providers,
};

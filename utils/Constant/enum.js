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
const enabledControls = {
  USERS: "users",
};

Object.freeze(roles);
Object.freeze(accountStatus);
Object.freeze(providers);
Object.freeze(enabledControls);

module.exports = {
  roles,
  accountStatus,
  providers,
  enabledControls
};

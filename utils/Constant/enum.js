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

const moveStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  PICKED_UP: "picked_up",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
};

const vehicleType = {
  BIKE: "bike",
  CAR: "car",
  VAN: "van",
  TRUCK: "truck",
};

Object.freeze(roles);
Object.freeze(accountStatus);
Object.freeze(providers);
Object.freeze(enabledControls);
Object.freeze(moveStatus);
Object.freeze(vehicleType);

module.exports = {
  roles,
  accountStatus,
  providers,
  enabledControls,
  moveStatus,
  vehicleType
};

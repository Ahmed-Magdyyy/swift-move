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

const driverStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
};

const moveStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  ARRIVED_AT_PICKUP: "arrived_at_pickup",
  PICKED_UP: "picked_up",
  ARRIVED_AT_DELIVERY: "arrived_at_delivery",
  DELIVERED: "delivered",
  CANCELLED_BY_CUSTOMER: "cancelled_by_customer",
  CANCELLED_BY_DRIVER: "cancelled_by_driver",
  CANCELLED_BY_ADMIN: "cancelled_by_admin",
  NO_DRIVERS_AVAILABLE: "no_drivers_available"
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
Object.freeze(driverStatus);
Object.freeze(moveStatus);
Object.freeze(vehicleType);

module.exports = {
  roles,
  accountStatus,
  providers,
  enabledControls,
  driverStatus,
  moveStatus,
  vehicleType
};

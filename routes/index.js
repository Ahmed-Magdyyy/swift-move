const authRoute = require("./authRoute");
const usersRoute = require("./usersRoute");
const moveRoutes = require("./moveRoutes");
const driverRoutes = require("./driverRoutes");

const mountRoutes = (app) => {
  app.use("/api/v1/auth", authRoute);
  app.use("/api/v1/users", usersRoute);
  app.use("/api/v1/moves", moveRoutes);
  app.use("/api/v1/drivers", driverRoutes);
};

module.exports = mountRoutes

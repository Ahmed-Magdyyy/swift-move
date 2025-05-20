const authRoute = require("./authRoute");
const usersRoute = require("./usersRoute");
const driversRoute = require("./driverRoute");


const mountRoutes = (app) => {
  app.use("/api/v1/auth", authRoute);
  app.use("/api/v1/users", usersRoute);
  app.use("/api/v1/drivers", driversRoute);
};

module.exports = mountRoutes

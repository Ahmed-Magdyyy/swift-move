const authRoute = require("./authRoute");
const usersRoute = require("./usersRoute");


const mountRoutes = (app) => {
  app.use("/api/v1/auth", authRoute);
  app.use("/api/v1/users", usersRoute);
};

module.exports = mountRoutes

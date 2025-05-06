const express = require("express");
const Router = express.Router();

const {
  uploadUserImage,
  //----- Admin Routes -----
  getUsers,
  getUser,
  createUser,
  deleteUser,
  updateUser,
  updateUserPassword,
  //----- /Admin Routes -----

  //----- User's Routes -----
  getLoggedUser,
  updateLoggedUserPassword,
  updateLoggedUserData,
  deleteLoggedUserData,
  //----- /User's Routes -----
} = require("../controllers/usersController");

const {
  protect,
  allowedTo,
  enabledControls,
} = require("../controllers/authController");

//----- User Routes -----

// applied on all routes
Router.use(protect);

Router.get("/getLoggedUser", getLoggedUser, getUser);
Router.put("/updateLoggedUserPassword", updateLoggedUserPassword);
Router.put("/updateLoggedUserData",uploadUserImage, updateLoggedUserData);
Router.delete("/deleteLoggedUserData", deleteLoggedUserData);

//----- /User Routes -----

//----- Admin Routes -----

Router.use(allowedTo("superAdmin", "admin"));
Router.use(enabledControls("users"));

Router.route("/").get(getUsers).post(createUser);

Router.route("/:id").get(getUser).delete(deleteUser).put(updateUser);

Router.put("/changePassword/:id", updateUserPassword);

//----- /Admin Routes -----

module.exports = Router;

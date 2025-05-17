const express = require("express");
const Router = express.Router();

const {
  createUserValidator,
  updateUserValidator,
  updateUserPasswordValidator,
  updateLoggedInUserPassword,
  updateLoggedInUserData
} = require("../Validation/userValidator");

const {
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
const { cloudUpload } = require("../utils/Cloudinary/cloudUpload");

const {
  protect,
  allowedTo,
  enabledControls,
} = require("../controllers/authController");

//----- User Routes -----

// applied on all routes
Router.use(protect);

Router.get("/getLoggedUser", getLoggedUser, getUser);
Router.put(
  "/updateLoggedUserPassword",
  updateLoggedInUserPassword,
  updateLoggedUserPassword
);
Router.put(
  "/updateLoggedUserData",
  cloudUpload({}).single("image"),
  updateLoggedInUserData,
  updateLoggedUserData
);
Router.delete("/deleteLoggedUserData", deleteLoggedUserData);

//----- /User Routes -----
// ============================================================= //
//----- Admin Routes -----

Router.use(allowedTo("superAdmin", "admin"));
Router.use(enabledControls("users"));

Router.route("/").get(getUsers).post(createUserValidator, createUser);

Router.route("/:id")
  .get(getUser)
  .delete(deleteUser)
  .put(updateUserValidator, updateUser);

Router.put(
  "/changePassword/:id",
  updateUserPasswordValidator,
  updateUserPassword
);

//----- /Admin Routes -----

module.exports = Router;

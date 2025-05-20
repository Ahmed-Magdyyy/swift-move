const express = require("express");
const router = express.Router();

const {
  submitOnboarding,
  getOnboardingStatus,
  updateAvailability,
  getOnboardings,
  updateDriverStatus,
  deleteDriver,
} = require("../controllers/driverController");

const {
  protect,
  allowedTo,
  enabledControls,
} = require("../controllers/authController");
const { cloudUpload } = require("../utils/Cloudinary/cloudUpload");

router.use(protect);

router
  .route("/onboarding")
  .post(
    allowedTo("driver"),
    cloudUpload({}).fields([
      { name: "id", maxCount: 1 },
      { name: "carDrivingLicense", maxCount: 1 },
      { name: "personalDrivingLicense", maxCount: 1 },
    ]),
    submitOnboarding
  )
  .get(
    allowedTo("admin", "superAdmin"),
    enabledControls("drivers"),
    getOnboardings
  );

router.get("/onboarding/status", allowedTo("driver"), getOnboardingStatus);
router.put("/ToggleAvailability", allowedTo("driver"), updateAvailability);
router.put(
  "/onboarding/:id/status",
  allowedTo("admin", "superAdmin"),
  enabledControls("drivers"),
  updateDriverStatus
);

router
  .route("/onboarding/:id")
  .delete(
    allowedTo("admin", "superAdmin"),
    enabledControls("drivers"),
    deleteDriver
  );

module.exports = router;

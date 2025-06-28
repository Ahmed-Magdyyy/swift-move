const express = require('express');
const router = express.Router();
const {
    getDriverProfile,
    updateDriverProfile,
    updateLocation,
    updateAvailability,
    submitOnboarding,
    updateDriverStatus,
    getAllDrivers,
    getDriver,
    deleteDriver,
    rateDriver
} = require('../controllers/driverController');
const { protect, allowedTo, enabledControls } = require('../controllers/authController');
const { cloudUpload } = require('../utils/Cloudinary/cloudUpload');
const {
    validateOnboarding,
    validateUpdateProfile,
    validateUpdateLocation,
    validateUpdateStatus,
    validateRateDriver,
    validateUpdateAvailability
} = require('../Validation/driverValidator');

router.use(protect)

// Driver routes
router.post(
    '/onboarding',
    cloudUpload({}).fields([
        { name: 'id', maxCount: 1 },
        { name: 'carDrivingLicense', maxCount: 1 },
        { name: 'personalDrivingLicense', maxCount: 1 }
    ]),
    allowedTo('driver'),
    validateOnboarding,
    submitOnboarding
);

router.route('/profile')
    .get(allowedTo('driver'), getDriverProfile)
    .put(
        allowedTo('driver', 'customer'),
        cloudUpload({}).fields([
            { name: 'id', maxCount: 1 },
            { name: 'carDrivingLicense', maxCount: 1 },
            { name: 'personalDrivingLicense', maxCount: 1 }
        ]),
        validateUpdateProfile,
        updateDriverProfile
    );

router.put('/availability', allowedTo('driver'), validateUpdateAvailability, updateAvailability);
router.put('/location', allowedTo('driver'), validateUpdateLocation, updateLocation);


// Admin routes
router.get('/', allowedTo('admin', 'superAdmin'), enabledControls('driver'), getAllDrivers);
router.get('/:id', allowedTo('admin', 'superAdmin'), enabledControls('driver'), getDriver);
router.put('/:id/status', allowedTo('admin', 'superAdmin'), enabledControls('driver'), validateUpdateStatus, updateDriverStatus);
router.delete('/:id', allowedTo('admin', 'superAdmin'), enabledControls('driver'), deleteDriver);


// Customer routes
router.post('/:id/rate', allowedTo('customer'), validateRateDriver, rateDriver);

module.exports = router; 
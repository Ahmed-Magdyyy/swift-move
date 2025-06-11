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
        updateDriverProfile
    );

router.put('/ToggleAvailability', allowedTo('driver'), updateAvailability);
router.put('/location', allowedTo('driver'), updateLocation);


// Admin routes
router.get('/', allowedTo('admin', 'superAdmin'), enabledControls('driver'), getAllDrivers);
router.get('/:id', allowedTo('admin', 'superAdmin'), enabledControls('driver'), getDriver);
router.put('/:id/status', allowedTo('admin', 'superAdmin'), enabledControls('driver'), updateDriverStatus);
router.delete('/:id', allowedTo('admin', 'superAdmin'), enabledControls('driver'), deleteDriver);


// Customer routes
router.post('/:id/rate', allowedTo('customer'), rateDriver);

module.exports = router; 
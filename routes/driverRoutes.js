const express = require('express');
const router = express.Router();
const {
    getDriverProfile,
    updateDriverProfile,
    updateLocation,
    updateAvailability,
    getEarnings,
    getNearbyDrivers,
    submitOnboarding,
    getOnboardingStatus,
    updateDriverStatus,
    getPendingDrivers,
    // confirmDriverProfile
} = require('../controllers/driverController');
const { protect, allowedTo } = require('../controllers/authController');
const { cloudUpload } = require('../utils/Cloudinary/cloudUpload');

router.use(protect)

// Driver onboarding routes
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
router.get('/onboarding/status', allowedTo('driver'), getOnboardingStatus);

// Admin routes for driver management
router.get('/pending', allowedTo('admin', 'superAdmin'), getPendingDrivers);
router.put('/:id/status', allowedTo('admin', 'superAdmin'), updateDriverStatus);
router.get('/nearby', allowedTo('driver'), getNearbyDrivers);

// Driver routes (only accessible after approval)
router.get('/profile', allowedTo('driver'), getDriverProfile);
router.put(
    '/profile',
    allowedTo('driver'),
    cloudUpload({}).fields([
        { name: 'id', maxCount: 1 },
        { name: 'carDrivingLicense', maxCount: 1 },
        { name: 'personalDrivingLicense', maxCount: 1 }
    ]),
    updateDriverProfile
);
router.put('/location', allowedTo('driver'), updateLocation);
router.put('/availability', allowedTo('driver'), updateAvailability);
router.get('/earnings', allowedTo('driver'), getEarnings);

module.exports = router; 
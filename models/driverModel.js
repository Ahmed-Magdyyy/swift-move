const mongoose = require('mongoose');
const { vehicleType } = require("../utils/Constant/enum");

const driverSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    vehicle: {
        type: {
            type: String,
            enum: Object.values(vehicleType),
            required: true
        },
        model: String,
        color: String,
        licensePlate: String
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    currentLocation: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            default: [0, 0]
        }
    },
    rating: {
        average: {
            type: Number,
            default: 0
        },
        count: {
            type: Number,
            default: 0
        }
    },
    documents: {
        id: {
            url: String,
            publicId: String
        },
        carDrivingLicense: {
            url: String,
            publicId: String
        },
        personalDrivingLicense: {
            url: String,
            publicId: String
        }
    },
    status: {
        type: String,
        enum: ['accepted', 'rejected', 'suspended'],
    },
    history:[String]
}, {
    timestamps: true
});

// Index for geospatial queries
driverSchema.index({ currentLocation: '2dsphere' });
driverSchema.index({ 'vehicle.type': 1, isAvailable: 1 });

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver; 
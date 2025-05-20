const mongoose = require('mongoose');
const { vehicleType } = require("../utils/Constant/enum");

const driverSchema = new mongoose.Schema({
    driver_info: {
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
        default: false
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
        enum: ['pending','accepted', 'rejected', 'suspended'],
        default: "pending"
    },
    history:[{
        _id: false,
        message: {
            type: String,
        },
        time:{
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

// Index for geospatial queries
driverSchema.index({ currentLocation: '2dsphere' });
driverSchema.index({ 'vehicle.type': 1, isAvailable: 1 });

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver; 
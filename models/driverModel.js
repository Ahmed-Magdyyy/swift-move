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
            default: 0,
            min: 0,
            max: 5
        },
        count: {
            type: Number,
            default: 0
        },
        reviews: [
            {
                customerId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'user',
                    required: true
                },
                moveId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Move',
                    required: true
                },
                rating: {
                    type: Number,
                    required: true,
                    min: 1,
                    max: 5,
                    validate: {
                        validator: Number.isInteger,
                        message: 'Rating must be an integer between 1 and 5'
                    }
                },
                comment: String,
                createdAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ]
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
        enum: ['pending', 'accepted', 'rejected', 'suspended'],
        default: 'pending'
    },
    history: [String]
}, {
    timestamps: true
});

// Index for geospatial queries
driverSchema.index({ currentLocation: '2dsphere' });
driverSchema.index({ 'vehicle.type': 1, isAvailable: 1 });

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver; 
const mongoose = require('mongoose');

const moveSchema = new mongoose.Schema({
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    driver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled'],
        default: 'pending'
    },
    pickup: {
        address: {
            type: String,
            required: true
        },
        coordinates: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true
            }
        },
        instructions: String
    },
    delivery: {
        address: {
            type: String,
            required: true
        },
        coordinates: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: true
            }
        },
        instructions: String
    },
    items: [{
        title: {
            type: String,
            required: true
        },
        description: String,
        dimensions: {
            length: Number,
            width: Number,
            height: Number
        },
        weight: Number,
        photos: [String],
        specialHandling: String
    }],
    vehicleType: {
        type: String,
        enum: ['bike', 'car', 'van', 'truck'],
        required: true
    },
    scheduledFor: {
        type: Date
    },
    insurance: {
        isSelected: {
            type: Boolean,
            default: false
        },
        type: {
            type: String,
            enum: ['basic', 'premium'],
            default: 'basic'
        },
        amount: Number
    },
    pricing: {
        basePrice: {
            type: Number,
            required: true
        },
        distancePrice: Number,
        insurancePrice: Number,
        totalPrice: {
            type: Number,
            required: true
        }
    },
    payment: {
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'refunded'],
            default: 'pending'
        },
        method: String,
        transactionId: String
    },
    actualTime: {
        pickup: Date,
        delivery: Date
    }
}, {
    timestamps: true
});

// Index for geospatial queries
moveSchema.index({ 'pickup.coordinates': '2dsphere' });
moveSchema.index({ 'delivery.coordinates': '2dsphere' });

// Index for common queries
moveSchema.index({ status: 1, customer: 1 });
moveSchema.index({ status: 1, driver: 1 });
moveSchema.index({ scheduledFor: 1 });

// Ensure actualTime is defined before trying to set sub-properties
moveSchema.pre('save', function(next) {
    if (this.isNew && !this.actualTime) {
        this.actualTime = {}; // Initialize if not present
    }
    if (this.status === 'picked_up' && !this.actualTime.pickup) {
        this.actualTime.pickup = new Date();
    }
    if (this.status === 'delivered' && !this.actualTime.delivery) {
        this.actualTime.delivery = new Date();
    }
    next();
});

const Move = mongoose.model('Move', moveSchema);

module.exports = Move;
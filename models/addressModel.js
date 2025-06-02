const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    label: {
        type: String,
        required: true,
        enum: ['home', 'work', 'other']
    },
    customLabel: {
        type: String,
        required: function() {
            return this.label === 'other';
        }
    },
    address: {
        type: String,
        required: true
    },
    location: {
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
    isDefault: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Index for geospatial queries
addressSchema.index({ location: '2dsphere' });
addressSchema.index({ user: 1, label: 1 });

const Address = mongoose.model('Address', addressSchema);

module.exports = Address; 
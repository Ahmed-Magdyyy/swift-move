const Move = require('../models/moveModel');
const Driver = require('../models/driverModel');
const trackingService = require('./trackingService');

class MoveRequestService {
    constructor() {
        this.pendingRequests = new Map(); // Map of moveId -> Set of notified drivers
    }

    async findNearbyDrivers(moveId, pickupLocation, vehicleType, radius = 5000) {
        try {
            // Find available drivers with matching vehicle type
            const drivers = await Driver.find({
                'vehicle.type': vehicleType,
                isAvailable: true,
                status: 'active',
                currentLocation: {
                    $near: {
                        $geometry: {
                            type: 'Point',
                            coordinates: pickupLocation
                        },
                        $maxDistance: radius
                    }
                }
            }).populate('user', 'name phone');

            return drivers;
        } catch (error) {
            throw new Error(`Failed to find nearby drivers: ${error.message}`);
        }
    }

    async notifyDrivers(moveId, drivers) {
        const move = await Move.findById(moveId);
        if (!move) return;

        // Store notified drivers
        this.pendingRequests.set(moveId, new Set(drivers.map(d => d._id.toString())));

        // Notify each driver
        drivers.forEach(driver => {
            trackingService.io.to(`driver:${driver._id}`).emit('move:request', {
                moveId,
                pickup: move.pickup,
                delivery: move.delivery,
                pricing: move.pricing,
                customer: move.customer
            });
        });
    }

    async handleDriverAcceptance(moveId, driverId) {
        const move = await Move.findById(moveId);
        if (!move) return false;

        // Check if driver was notified
        const notifiedDrivers = this.pendingRequests.get(moveId);
        if (!notifiedDrivers?.has(driverId.toString())) {
            return false;
        }

        // Update move status
        move.driver = driverId;
        move.status = 'accepted';
        await move.save();

        // Update driver status
        await Driver.findByIdAndUpdate(driverId, { isAvailable: false });

        // Clear pending requests
        this.pendingRequests.delete(moveId);

        // Notify customer
        trackingService.io.to(`customer:${move.customer}`).emit('move:accepted', {
            moveId,
            driverId
        });

        return true;
    }

    async handleDriverRejection(moveId, driverId, reason) {
        const notifiedDrivers = this.pendingRequests.get(moveId);
        if (!notifiedDrivers) return;

        // Remove driver from notified set
        notifiedDrivers.delete(driverId.toString());

        // If no more drivers to notify, mark move as cancelled
        if (notifiedDrivers.size === 0) {
            const move = await Move.findById(moveId);
            if (move) {
                move.status = 'cancelled';
                await move.save();
                
                trackingService.io.to(`customer:${move.customer}`).emit('move:cancelled', {
                    moveId,
                    reason: 'No drivers available'
                });
            }
            this.pendingRequests.delete(moveId);
        }
    }
}

module.exports = new MoveRequestService(); 
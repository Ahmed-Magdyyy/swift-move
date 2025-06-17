// services/moveRequestService.js
const mongoose = require('mongoose');
const Move = require('../models/moveModel');
const Driver = require('../models/driverModel');
const User = require('../models/userModel');
const pricingService = require('./pricingService');
const googleMapsService = require('./googleMapsService');
const trackingService = require('./trackingService');
const { moveStatus, userRoles } = require('../utils/Constant/enum');
const ApiError = require('../utils/ApiError');

const MAX_DRIVER_SEARCH_ATTEMPTS = 3;
const DRIVER_RESPONSE_TIMEOUT = 30000; // 30 seconds

class MoveRequestService {
    constructor() {
        this.pendingDriverNotifications = new Map();
    }

    async initiateNewMove(customerId, moveData) {
        const { pickup, delivery, items, vehicleType, scheduledFor } = moveData;
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const customer = await User.findById(customerId).session(session);
            if (!customer) throw new ApiError('Customer not found.', 404);

            const pricingDetails = await pricingService.calculateMovePrice(
                pickup, delivery, vehicleType
            );

            const move = new Move({
                customer: customerId, pickup, delivery, items, vehicleType,
                scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
                pricing: {
                    basePrice: pricingDetails.basePrice,
                    distancePrice: pricingDetails.distancePrice,
                    totalPrice: pricingDetails.totalPrice
                },
                status: moveStatus.PENDING,
                routePolyline: pricingDetails.polyline,
            });
            await move.save({ session });

            if (move.scheduledFor && move.scheduledFor > new Date(Date.now() + 5 * 60 * 1000)) {
                await session.commitTransaction();
                trackingService.notifyCustomer(customerId, 'move:scheduled', { /* ... */ });
                return move.toObject();
            }

            await this._findAndNotifyDrivers(move, session);
            return move.toObject();
        } catch (error) {
            await session.abortTransaction();
            if (error instanceof ApiError) throw error;
            console.error('Error in initiateNewMove:', error);
            throw new ApiError(`Failed to initiate new move: ${error.message}`, 500);
        } finally {
            session.endSession();
        }
    }

    async _findAndNotifyDrivers(move, session, attempt = 1, excludedDriverIds = []) {
        const pickupCoords = move.pickup.coordinates.coordinates;
        const vehicleType = move.vehicleType;

        // Fetch all nearby drivers
        const allNearbyDrivers = await googleMapsService.getNearbyDrivers(pickupCoords, vehicleType, 5000) || [];

        // Manually filter out drivers who have already been excluded in previous attempts.
        // This assumes that driver objects returned by getNearbyDrivers have a 'driverId' property.
        const nearbyDrivers = allNearbyDrivers.filter(
            driver => !excludedDriverIds.includes(driver.driverId)
        );

        if (!nearbyDrivers || nearbyDrivers.length === 0) {
            if (attempt === 1) {
                move.status = moveStatus.NO_DRIVERS_AVAILABLE;
                await move.save({ session });
                await session.commitTransaction();
                trackingService.notifyCustomer(move.customer.toString(), 'move:no_drivers_found', { moveId: move._id.toString() });
                return;
            } else {
                if (session && session.inTransaction()) await session.commitTransaction();
                return;
            }
        }
        const driverToNotify = nearbyDrivers[0];
        const notificationData = {
            notifiedDrivers: [driverToNotify.driverId], currentDriverId: driverToNotify.driverId,
            attempt: attempt,
            timeoutId: setTimeout(() => this.handleDriverResponseTimeout(move._id.toString(), driverToNotify.driverId), DRIVER_RESPONSE_TIMEOUT),
            excludedDriverIds: [...excludedDriverIds, driverToNotify.driverId]
        };
        this.pendingDriverNotifications.set(move._id.toString(), notificationData);
        trackingService.notifyDriver(driverToNotify.driverId, 'move:request_new', { /* ... */ });
        if (session && session.inTransaction()) await session.commitTransaction();
    }

    async handleDriverResponseTimeout(moveId, driverId) {
        const notificationState = this.pendingDriverNotifications.get(moveId);
        if (!notificationState || notificationState.currentDriverId !== driverId) return;
        this.pendingDriverNotifications.delete(moveId);
        await this.handleDriverRejection(moveId, driverId, "timeout");
    }

    async acceptMoveRequest(moveId, driverUserId) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const move = await Move.findById(moveId).populate('customer').session(session);
            if (!move) throw new ApiError('Move not found.', 404);
            if (move.status !== moveStatus.PENDING) throw new ApiError('Move is not pending and cannot be accepted.', 409); // 409 Conflict
            if (move.driver) throw new ApiError('Move already has a driver assigned.', 409);

            const driver = await Driver.findOne({ user: driverUserId }).populate('user').session(session);
            if (!driver || !driver.isAvailable || driver.status !== 'active') {
                throw new ApiError('Driver not found, not available, or not active.', 404); // Or 400 if driverId is invalid
            }
            if (driver.vehicle.type !== move.vehicleType) {
                throw new ApiError('Driver vehicle type does not match requested type.', 400);
            }

            move.driver = driver.user._id;
            move.status = moveStatus.ACCEPTED;
            if (!move.actualTime) move.actualTime = {}; // Ensure actualTime object exists
            move.actualTime.driverAssignedAt = new Date();

            driver.isAvailable = false;
            await move.save({ session });
            await driver.save({ session });

            const notificationState = this.pendingDriverNotifications.get(moveId);
            if (notificationState && notificationState.timeoutId) {
                clearTimeout(notificationState.timeoutId);
                this.pendingDriverNotifications.delete(moveId);
            }
            await session.commitTransaction();
            trackingService.notifyCustomer(move.customer._id.toString(), 'move:accepted', { /* ... */ });
            return move.toObject();
        } catch (error) {
            await session.abortTransaction();
            if (error instanceof ApiError) throw error;
            console.error(`Error accepting move ${moveId} by driver ${driverUserId}:`, error);
            trackingService.notifyDriver(driverUserId, 'move:acceptance_failed', { moveId, reason: error.message });
            throw new ApiError(`Failed to accept move: ${error.message}`, 500);
        } finally {
            session.endSession();
        }
    }

    async handleDriverRejection(moveId, driverUserId, reason = "rejected") {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const move = await Move.findById(moveId).session(session);
            if (!move || move.status !== moveStatus.PENDING || move.driver) {
                if (session.inTransaction()) await session.abortTransaction();
                return;
            }

            const notificationState = this.pendingDriverNotifications.get(moveId);
            let excludedDriverIds = notificationState ? notificationState.excludedDriverIds : [driverUserId];
            let currentAttempt = notificationState ? notificationState.attempt : 0;

            if (notificationState && notificationState.timeoutId) clearTimeout(notificationState.timeoutId);
            this.pendingDriverNotifications.delete(moveId);

            if (currentAttempt < MAX_DRIVER_SEARCH_ATTEMPTS) {
                await this._findAndNotifyDrivers(move, session, currentAttempt + 1, excludedDriverIds);
            } else {
                move.status = moveStatus.NO_DRIVERS_AVAILABLE;
                await move.save({ session });
                await session.commitTransaction();
                trackingService.notifyCustomer(move.customer.toString(), 'move:no_drivers_found', { /* ... */ });
            }
        } catch (error) {
            if (session.inTransaction()) await session.abortTransaction();
            if (error instanceof ApiError) throw error;
            console.error(`Error handling driver rejection for move ${moveId}:`, error);
            throw new ApiError(`Failed to handle driver rejection: ${error.message}`, 500);
        } finally {
            if (session.inTransaction()) { // Ensure session ends if not committed by _findAndNotifyDrivers
                try { await session.abortTransaction(); } catch (e) { console.error("Error aborting transaction in finally:", e); }
            }
            session.endSession();
        }
    }

    async updateMoveProgress(moveId, driverUserId, newStatus, updateData = {}) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const move = await Move.findById(moveId).populate('customer').populate('driver').session(session);
            if (!move) throw new ApiError('Move not found.', 404);
            if (!move.driver || move.driver._id.toString() !== driverUserId) {
                throw new ApiError('Driver not authorized for this move.', 403);
            }
            if (!this._isValidStatusTransition(move.status, newStatus)) {
                throw new ApiError(`Invalid status transition from ${move.status} to ${newStatus}.`, 400);
            }

            move.status = newStatus;
            const now = new Date();
            if (!move.actualTime) move.actualTime = {};

            switch (newStatus) {
                case moveStatus.ARRIVED_AT_PICKUP: move.actualTime.arrivedAtPickup = now; break;
                case moveStatus.PICKED_UP: move.actualTime.pickup = now; break;
                case moveStatus.ARRIVED_AT_DELIVERY: move.actualTime.arrivedAtDelivery = now; break;
                case moveStatus.DELIVERED:
                    move.actualTime.delivery = now;
                    await this._finalizeMoveCompletion(move, session);
                    break;
            }
            if (updateData.currentLocation) move.lastKnownDriverLocation = { type: 'Point', coordinates: updateData.currentLocation };
            await move.save({ session });
            await session.commitTransaction();
            trackingService.notifyCustomer(move.customer._id.toString(), 'move:status_update', { /* ... */ });
            if (newStatus === moveStatus.DELIVERED) trackingService.notifyDriver(driverUserId, 'move:completed_on_driver_side', { moveId });
            return move.toObject();
        } catch (error) {
            await session.abortTransaction();
            if (error instanceof ApiError) throw error;
            console.error(`Error updating move ${moveId} progress:`, error);
            throw new ApiError(`Failed to update move progress: ${error.message}`, 500);
        } finally {
            session.endSession();
        }
    }

    _isValidStatusTransition(currentStatus, newStatus) {
        const flow = {
            [moveStatus.ACCEPTED]: [moveStatus.ARRIVED_AT_PICKUP, moveStatus.CANCELLED_BY_DRIVER, moveStatus.CANCELLED_BY_CUSTOMER],
            [moveStatus.ARRIVED_AT_PICKUP]: [moveStatus.PICKED_UP, moveStatus.CANCELLED_BY_DRIVER, moveStatus.CANCELLED_BY_CUSTOMER],
            [moveStatus.PICKED_UP]: [moveStatus.IN_TRANSIT, moveStatus.CANCELLED_BY_DRIVER],
            [moveStatus.IN_TRANSIT]: [moveStatus.ARRIVED_AT_DELIVERY, moveStatus.CANCELLED_BY_DRIVER], // Driver might still cancel if major issue
            [moveStatus.ARRIVED_AT_DELIVERY]: [moveStatus.DELIVERED],
        };
        return (flow[currentStatus] && flow[currentStatus].includes(newStatus)) ||
               (currentStatus === moveStatus.PENDING && [moveStatus.CANCELLED_BY_CUSTOMER, moveStatus.NO_DRIVERS_AVAILABLE, moveStatus.ACCEPTED].includes(newStatus));
    }

    async getMoveDetails(moveId, userId, userRole) {
        if (!moveId) {
            throw new ApiError('Move ID is required.', 400);
        }

        // 1. Fetch the move and populate customer/driver user details
        const move = await Move.findById(moveId)
            .populate('customer', 'name email phone role')
            .populate('driver', 'name email phone role') // This populates the user doc for the driver
            .lean();

        if (!move) {
            throw new ApiError('Move not found.', 404);
        }

        // 2. Authorization check
        const isCustomer = move.customer && move.customer._id.toString() === userId.toString();
        const isDriver = move.driver && move.driver._id.toString() === userId.toString();
        const isAdmin = userRole === userRoles.ADMIN;

        if (!isCustomer && !isDriver && !isAdmin) {
            throw new ApiError('Not authorized to view this move.', 403);
        }

        // 3. If a driver is assigned, fetch their specific driver details (like vehicle)
        if (move.driver) {
            const driverDetails = await Driver.findOne({ user: move.driver._id })
                .select('vehicle rating.average') // Select specific fields from the Driver model
                .lean();
            
            // 4. Combine the driver-specific details into the move object
            if (driverDetails) {
                // To avoid overwriting the whole driver object, we attach details to it
                move.driver.vehicle = driverDetails.vehicle;
                move.driver.averageRating = driverDetails.rating.average;
            }
        }

        return move;
    }

    async getMovesForDriver(driverUserId) {
        if (!driverUserId) {
            throw new ApiError('Driver ID is required.', 400);
        }
        try {
            // Note: The driver on the Move model is a reference to the 'user' document.
            const moves = await Move.find({ driver: driverUserId })
                .sort({ createdAt: -1 })
                .lean();
            return moves;
        } catch (error) {
            console.error(`Error fetching moves for driver ${driverUserId}:`, error);
            throw new ApiError('Failed to retrieve driver moves.', 500);
        }
    }

    async getMovesForCustomer(customerId) {
        if (!customerId) {
            throw new ApiError('Customer ID is required.', 400);
        }
        try {
            const moves = await Move.find({ customer: customerId })
                .sort({ createdAt: -1 })
                .lean();
            return moves;
        } catch (error) {
            console.error(`Error fetching moves for customer ${customerId}:`, error);
            throw new ApiError('Failed to retrieve customer moves.', 500);
        }
    }

    async _finalizeMoveCompletion(move, existingSession) {
        const driver = await Driver.findOne({ user: move.driver }).session(existingSession); // Use findOne with user ref
        if (driver) {
            driver.isAvailable = true;
            await driver.save({ session: existingSession });
        }
    }

    async cancelMoveRequest(moveId, userId, userRole, reason = "No reason provided") {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const move = await Move.findById(moveId).populate('driver').populate('customer').session(session);
            if (!move) throw new ApiError('Move not found.', 404);

            let canCancel = false;
            let newStatus = moveStatus.CANCELLED_BY_CUSTOMER;

            if (userRole === userRoles.CUSTOMER && move.customer._id.toString() === userId) {
                if ([moveStatus.PENDING, moveStatus.ACCEPTED, moveStatus.ARRIVED_AT_PICKUP].includes(move.status)) canCancel = true;
            } else if (userRole === userRoles.DRIVER && move.driver && move.driver._id.toString() === userId) {
                if ([moveStatus.ACCEPTED, moveStatus.ARRIVED_AT_PICKUP, moveStatus.IN_TRANSIT].includes(move.status)) { // Driver might cancel during transit for emergencies
                    canCancel = true; newStatus = moveStatus.CANCELLED_BY_DRIVER;
                }
            } else if (userRole === userRoles.ADMIN) {
                canCancel = true; newStatus = moveStatus.CANCELLED_BY_ADMIN;
            }

            if (!canCancel) throw new ApiError(`User ${userId} (${userRole}) cannot cancel move ${moveId} in state ${move.status}.`, 403);

            move.status = newStatus;
            move.cancellationReason = reason;
            if (!move.actualTime) move.actualTime = {};
            move.actualTime.cancelledAt = new Date();

            if (move.driver && (newStatus === moveStatus.CANCELLED_BY_CUSTOMER || newStatus === moveStatus.CANCELLED_BY_ADMIN)) {
                const driverDoc = await Driver.findOne({ user: move.driver._id }).session(session);
                if (driverDoc) { driverDoc.isAvailable = true; await driverDoc.save({ session }); }
            }
             // If driver cancels, their availability might be handled by a different policy or manually by admin if it's frequent.
             // For now, if driver cancels, we don't automatically make them available here.

            await move.save({ session });
            await session.commitTransaction();
            // Notify relevant parties
            return move.toObject();
        } catch (error) {
            await session.abortTransaction();
            if (error instanceof ApiError) throw error;
            console.error(`Error cancelling move ${moveId}:`, error);
            throw new ApiError(`Failed to cancel move: ${error.message}`, 500);
        } finally {
            session.endSession();
        }
    }

    // AddRatingToMove and other methods would also use ApiError
}

module.exports = new MoveRequestService();
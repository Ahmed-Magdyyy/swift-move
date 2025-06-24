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
        let move;
        
        try {
            await session.withTransaction(async () => {
                // Verify customer exists
                const customer = await User.findById(customerId).session(session);
                if (!customer) throw new ApiError('Customer not found.', 404);

                // Calculate pricing
                const pricingDetails = await pricingService.calculateMovePrice(
                    pickup, delivery, vehicleType
                );

                // Create the move
                move = new Move({
                    customer: customerId, 
                    pickup, 
                    delivery, 
                    items, 
                    vehicleType,
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

                // If this is a scheduled move for the future, just save it and notify
                if (move.scheduledFor && move.scheduledFor > new Date(Date.now() + 5 * 60 * 1000)) {
                    trackingService.notifyCustomer(customerId, 'move:scheduled', { 
                        moveId: move._id.toString(),
                        scheduledFor: move.scheduledFor,
                        message: 'Your move has been scheduled.'
                    });
                    return; // Transaction will be committed automatically
                }

                // For immediate moves, find and notify drivers
                // The transaction will be committed in _findAndNotifyDrivers if needed
                await this._findAndNotifyDrivers(move, session);
            });

            // If we get here, the transaction was successful
            return move ? move.toObject() : null;
            
        } catch (error) {
            console.error('Error in initiateNewMove:', error);
            
            // Notify customer of failure if we have their ID
            if (customerId) {
                trackingService.notifyCustomer(customerId, 'move:creation_failed', { 
                    reason: error.message || 'Failed to create move request',
                    error: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
            
            // Re-throw ApiError as is, wrap others
            if (error instanceof ApiError) throw error;
            throw new ApiError(`Failed to initiate new move: ${error.message}`, 500);
            
        } finally {
            try {
                await session.endSession();
            } catch (e) {
                console.error('Error ending session in initiateNewMove:', e);
            }
        }
    }

    async _findAndNotifyDrivers(move, session, attempt = 1, excludedDriverIds = []) {
        const pickupCoords = move.pickup.coordinates.coordinates;
        const vehicleType = move.vehicleType;

        try {
            // Fetch all nearby drivers
            const allNearbyDrivers = await googleMapsService.getNearbyDrivers(pickupCoords, vehicleType, 5000) || [];

            // Manually filter out drivers who have already been excluded in previous attempts
            const nearbyDrivers = allNearbyDrivers.filter(
                driver => !excludedDriverIds.includes(driver.driverId)
            );

            if (!nearbyDrivers || nearbyDrivers.length === 0) {
                if (attempt === 1) {
                    move.status = moveStatus.NO_DRIVERS_AVAILABLE;
                    await move.save({ session });
                    await session.commitTransaction();
                    trackingService.notifyCustomer(move.customer.toString(), 'move:no_drivers_found', { 
                        moveId: move._id.toString(),
                        message: 'No available drivers found in your area.'
                    });
                } else {
                    await session.commitTransaction();
                }
                return;
            }

            // Save the move with updated status if this is the first attempt
            if (attempt === 1) {
                move.status = moveStatus.PENDING;
                await move.save({ session });
            }

            // Notify the first available driver
            const driverToNotify = nearbyDrivers[0];
            const notificationData = {
                notifiedDrivers: [driverToNotify.driverId],
                currentDriverId: driverToNotify.driverId,
                attempt: attempt,
                session: session, // Keep session reference for later use
                timeoutId: setTimeout(
                    () => this.handleDriverResponseTimeout(move._id.toString(), driverToNotify.driverId), 
                    DRIVER_RESPONSE_TIMEOUT
                ),
                excludedDriverIds: [...excludedDriverIds, driverToNotify.driverId]
            };

            this.pendingDriverNotifications.set(move._id.toString(), notificationData);
            
            // Send notification to the driver
            trackingService.notifyDriver(driverToNotify.driverId, 'driver:new_move_request', { 
                move: move.toObject(),
                pickupLocation: move.pickup,
                deliveryLocation: move.delivery,
                vehicleType: move.vehicleType,
                price: move.pricing.totalPrice
            });
            
            // Don't commit the transaction here - it will be committed when the driver responds or times out
        } catch (error) {
            console.error('Error in _findAndNotifyDrivers:', error);
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            throw error;
        }
    }

    async handleDriverResponseTimeout(moveId, driverId) {
        console.log(`Driver ${driverId} did not respond to move ${moveId} within timeout period`);
        const notificationState = this.pendingDriverNotifications.get(moveId);
        
        // If no notification state or the driver ID doesn't match, it might have been handled already
        if (!notificationState || notificationState.currentDriverId !== driverId) {
            console.log(`No matching notification state or driver ID mismatch for move ${moveId}`);
            return;
        }
        
        // Clear the timeout to prevent multiple calls
        if (notificationState.timeoutId) {
            clearTimeout(notificationState.timeoutId);
        }
        
        // Remove from pending notifications before handling rejection
        this.pendingDriverNotifications.delete(moveId);
        
        try {
            // Handle the rejection with the existing session if available
            await this.handleDriverRejection(moveId, driverId, "timeout");
        } catch (error) {
            console.error(`Error in handleDriverResponseTimeout for move ${moveId}:`, error);
            // If there's an error, we've already cleaned up the notification state
            // The error would have been logged by handleDriverRejection
        }
    }

    async acceptMoveRequest(moveId, driverUserId) {
        const session = await mongoose.startSession();
        let move, driver, notificationState;
        
        try {
            await session.withTransaction(async () => {
                // Get the move with the customer populated
                move = await Move.findById(moveId).populate('customer').session(session);
                if (!move) throw new ApiError('Move not found.', 404);
                
                // Check if the move can be accepted
                if (move.status !== moveStatus.PENDING) {
                    throw new ApiError('Move is not pending and cannot be accepted.', 409);
                }
                
                if (move.driver) {
                    throw new ApiError('Move already has a driver assigned.', 409);
                }

                // Get the driver with user populated
                driver = await Driver.findOne({ user: driverUserId }).populate('user').session(session);
                if (!driver) {
                    throw new ApiError('Driver not found.', 404);
                }
                
                if (!driver.isAvailable || driver.status !== 'accepted') {
                    throw new ApiError('Driver is not available or not accepted.', 400);
                }
                
                if (driver.vehicle.type !== move.vehicleType) {
                    throw new ApiError('Driver vehicle type does not match requested type.', 400);
                }

                // Update the move with the driver
                move.driver = driver.user._id;
                move.status = moveStatus.ACCEPTED;
                if (!move.actualTime) move.actualTime = {};
                // move.actualTime.driverAssignedAt = new Date();

                // Mark the driver as unavailable
                driver.isAvailable = false;

                // Save changes
                await move.save({ session });
                await driver.save({ session });
                
                // Get the notification state before we commit the transaction
                notificationState = this.pendingDriverNotifications.get(moveId);
            });
            
            // If we get here, the transaction was successful
            // Now clean up any pending notifications
            if (notificationState) {
                if (notificationState.timeoutId) {
                    clearTimeout(notificationState.timeoutId);
                }
                this.pendingDriverNotifications.delete(moveId);
            }
            
            // Notify the customer that their move was accepted
            trackingService.notifyCustomer(move.customer._id.toString(), 'move:accepted', {
                moveId: move._id.toString(),
                driver: {
                    id: driver.user._id.toString(),
                    name: driver.user.name,
                    phone: driver.user.phone,
                    vehicle: driver.vehicle,
                    rating: driver.rating
                },
                estimatedArrival: '5-10 minutes', // You might want to calculate this
                message: 'A driver has accepted your move request!'
            });
            
            return move.toObject();
            
        } catch (error) {
            console.error(`Error in acceptMoveRequest for move ${moveId} by driver ${driverUserId}:`, error);
            
            // Notify the driver of the failure
            if (driverUserId) {
                trackingService.notifyDriver(driverUserId, 'move:acceptance_failed', { 
                    moveId,
                    reason: error.message || 'Unknown error accepting move'
                });
            }
            
            // Re-throw ApiError as is, wrap others
            if (error instanceof ApiError) throw error;
            throw new ApiError(`Failed to accept move: ${error.message}`, 500);
            
        } finally {
            try {
                await session.endSession();
            } catch (e) {
                console.error('Error ending session in acceptMoveRequest:', e);
            }
        }
    }

    async handleDriverRejection(moveId, driverUserId, reason = "rejected") {
        let session;
        try {
            // Get the existing session from pending notifications if available
            const notificationState = this.pendingDriverNotifications.get(moveId);
            
            // If no notification state, the move might have been accepted by another driver
            if (!notificationState) {
                console.log(`No notification state found for move ${moveId}, it may have been accepted by another driver`);
                return;
            }

            // Clear the timeout if it exists
            if (notificationState.timeoutId) {
                clearTimeout(notificationState.timeoutId);
            }

            // Use the existing session if available, or create a new one
            session = notificationState.session || await mongoose.startSession();
            if (!notificationState.session) {
                session.startTransaction();
            }

            const move = await Move.findById(moveId).session(session);
            if (!move || move.status !== moveStatus.PENDING || move.driver) {
                if (session.inTransaction()) await session.abortTransaction();
                return;
            }

            const excludedDriverIds = notificationState.excludedDriverIds || [driverUserId];
            const currentAttempt = notificationState.attempt || 0;

            // Remove from pending notifications
            this.pendingDriverNotifications.delete(moveId);

            if (currentAttempt < MAX_DRIVER_SEARCH_ATTEMPTS) {
                // Find and notify the next driver using the existing session
                await this._findAndNotifyDrivers(move, session, currentAttempt + 1, excludedDriverIds);
            } else {
                // No more attempts, mark as no drivers available
                move.status = moveStatus.NO_DRIVERS_AVAILABLE;
                await move.save({ session });
                await session.commitTransaction();
                
                trackingService.notifyCustomer(move.customer.toString(), 'move:no_drivers_found', { 
                    moveId: move._id.toString(),
                    message: 'No drivers accepted your request. Please try again later.'
                });
            }
        } catch (error) {
            console.error(`Error handling driver rejection for move ${moveId}:`, error);
            if (session && session.inTransaction()) {
                await session.abortTransaction();
            }
            
            // Only throw if it's an ApiError, otherwise just log it
            if (error instanceof ApiError) throw error;
            console.error(`Non-ApiError in handleDriverRejection: ${error.message}`);
        } finally {
            if (session) {
                try {
                    // Only end the session if we created it (it's not from the notification state)
                    if (!notificationState || !notificationState.session) {
                        await session.endSession();
                    }
                } catch (e) {
                    console.error("Error ending session in handleDriverRejection:", e);
                }
            }
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
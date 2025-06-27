// services/moveRequestService.js
const mongoose = require('mongoose');
const Move = require('../models/moveModel');
const Driver = require('../models/driverModel');
const User = require('../models/userModel');
const pricingService = require('./pricingService');
const googleMapsService = require('./googleMapsService');
const trackingService = require('./trackingService');
const { moveStatus, roles } = require('../utils/Constant/enum');
const ApiError = require('../utils/ApiError');

const MAX_DRIVER_SEARCH_ATTEMPTS = 3;
const DRIVER_RESPONSE_TIMEOUT = 60000; // 60 seconds

class MoveRequestService {
    constructor() {
        this.pendingDriverNotifications = new Map();
    }

    async initiateNewMove(customerId, moveData) {
        // 1. Check if the customer already has an active move
        const terminalStates = [
            moveStatus.DELIVERED,
            moveStatus.CANCELLED_BY_ADMIN,
            moveStatus.CANCELLED_BY_CUSTOMER,
            moveStatus.CANCELLED_BY_DRIVER,
            moveStatus.NO_DRIVERS_AVAILABLE
        ];

        const existingMove = await Move.findOne({
            customer: customerId,
            status: { $nin: terminalStates }
        });

        if (existingMove) {
            throw new ApiError('You already have an active move. You cannot create a new one until the current move is completed or cancelled.', 409);
        }

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
                move = await Move.findById(moveId).populate('customer', '_id name email phone image').session(session);
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
                message: 'A driver has accepted your move request!',
                moveId: move._id.toString(),
                driver: {
                    id: driver.user._id.toString(),
                    name: driver.user.name,
                    phone: driver.user.phone,
                    vehicle: driver.vehicle,
                    rating: driver.rating
                },
                estimatedArrival: '5-10 minutes', // You might want to calculate this
            });

            // Also, notify the driver for confirmation
            trackingService.notifyDriver(driver.user._id.toString(), 'driver:move_accepted_confirmation', {
                message: 'You have successfully accepted the move. Please go to the pickup location.',
                move: move.toObject()
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
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const notificationState = this.pendingDriverNotifications.get(moveId);
                if (!notificationState) {
                    console.warn(`[MoveRequestService] No notification state for move ${moveId} during rejection. Assuming it was handled.`);
                    return; // Exit transaction gracefully
                }

                if (notificationState.timeoutId) {
                    clearTimeout(notificationState.timeoutId);
                }

                const move = await Move.findById(moveId).session(session);
                if (!move || move.status !== moveStatus.PENDING) {
                    this.pendingDriverNotifications.delete(moveId); // Clean up state
                    return;
                }

                const excludedDriverIds = [...notificationState.excludedDriverIds];
                const pickupCoords = move.pickup.coordinates.coordinates;
                const allNearbyDrivers = await googleMapsService.getNearbyDrivers(pickupCoords, move.vehicleType, 5000) || [];
                const nextDriverToNotify = allNearbyDrivers.find(d => !excludedDriverIds.includes(d.driverId));

                if (nextDriverToNotify) {
                    const newNotificationData = {
                        ...notificationState,
                        currentDriverId: nextDriverToNotify.driverId,
                        excludedDriverIds: [...excludedDriverIds, nextDriverToNotify.driverId],
                        timeoutId: setTimeout(
                            () => this.handleDriverResponseTimeout(move._id.toString(), nextDriverToNotify.driverId),
                            DRIVER_RESPONSE_TIMEOUT
                        )
                    };
                    this.pendingDriverNotifications.set(moveId, newNotificationData);
                    trackingService.notifyDriver(nextDriverToNotify.driverId, 'driver:new_move_request', { move: move.toObject() });
                    console.log(`[MoveRequestService] Rejection from ${driverUserId}, notifying next driver ${nextDriverToNotify.driverId} for move ${moveId}`);
                } else {
                    move.status = moveStatus.NO_DRIVERS_AVAILABLE;
                    await move.save({ session });
                    this.pendingDriverNotifications.delete(moveId); // Clean up state
                    trackingService.notifyCustomer(move.customer.toString(), 'move:no_drivers_found', {
                        moveId: move._id.toString(),
                        message: 'No available drivers found after searching.'
                    });
                    console.log(`[MoveRequestService] No more drivers to notify for move ${moveId}`);
                }
            });
        } catch (error) {
            console.error(`Critical error in handleDriverRejection for move ${moveId}:`, error);
            this.pendingDriverNotifications.delete(moveId); // Clean up state
        } finally {
            await session.endSession();
        }
    }

    async updateMoveProgress(moveId, driverUserId, newStatus) {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const move = await Move.findById(moveId).populate('customer','_id name email phone image').populate('driver','_id name email phone image').session(session);
            if (!move) throw new ApiError('Move not found.', 404);
            
            if (!move.driver || move.driver._id.toString() !== driverUserId.toString()) {
                throw new ApiError('Driver not authorized for this move.', 403);
            }

            if(move.status === moveStatus.DELIVERED) {
                throw new ApiError('Cant update move status as it is already delivered.', 400);
            }

            if (!this._isValidStatusTransition(move.status, newStatus)) {
                throw new ApiError(`Invalid status transition from ${move.status} to ${newStatus}.`, 400);
            }

            move.status = newStatus;

            if (newStatus === moveStatus.DELIVERED) {
                await this._finalizeMoveCompletion(move, session);
            }

            await move.save({ session });
            await session.commitTransaction();

            // --- Notify Customer of Progress ---
            const customerId = move.customer._id.toString();
            let notificationMessage = '';

            switch (newStatus) {
                case moveStatus.ARRIVED_AT_PICKUP:
                    notificationMessage = 'Your driver has arrived at the pickup location.';
                    break;
                case moveStatus.PICKED_UP:
                    notificationMessage = 'Your items have been picked up and the move is now in transit.';
                    break;
                case moveStatus.ARRIVED_AT_DELIVERY:
                    notificationMessage = 'Your driver has arrived at the delivery location.';
                    break;
                case moveStatus.DELIVERED:
                    notificationMessage = 'Your move has been successfully completed!';
                    break;
            }

            if (notificationMessage) {
                trackingService.notifyCustomer(customerId, 'move:status_update', {
                    moveId: move._id.toString(),
                    status: newStatus,
                    message: notificationMessage
                });
            }

            // --- Notify Driver on Completion ---
            if (newStatus === moveStatus.DELIVERED) {
                trackingService.notifyDriver(move.driver._id.toString(), 'move:completed_on_driver_side', { 
                    moveId, 
                    message: 'Move successfully completed. Thank you!' 
                });
            }

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
            [moveStatus.PENDING]: [
                moveStatus.ACCEPTED,
                moveStatus.NO_DRIVERS_AVAILABLE,
                moveStatus.CANCELLED_BY_CUSTOMER,
                moveStatus.CANCELLED_BY_ADMIN
            ],
            [moveStatus.ACCEPTED]: [
                moveStatus.ARRIVED_AT_PICKUP,
                moveStatus.CANCELLED_BY_CUSTOMER,
                moveStatus.CANCELLED_BY_DRIVER,
                moveStatus.CANCELLED_BY_ADMIN
            ],
            [moveStatus.ARRIVED_AT_PICKUP]: [
                moveStatus.PICKED_UP,
                moveStatus.CANCELLED_BY_CUSTOMER,
                moveStatus.CANCELLED_BY_DRIVER,
                moveStatus.CANCELLED_BY_ADMIN
            ],
            [moveStatus.PICKED_UP]: [
                moveStatus.ARRIVED_AT_DELIVERY,
                moveStatus.CANCELLED_BY_CUSTOMER,
                moveStatus.CANCELLED_BY_DRIVER,
                moveStatus.CANCELLED_BY_ADMIN
            ],
            [moveStatus.ARRIVED_AT_DELIVERY]: [
                moveStatus.DELIVERED,
                moveStatus.CANCELLED_BY_ADMIN
            ],
        };

        const terminalStates = [
            moveStatus.DELIVERED,
            moveStatus.CANCELLED_BY_ADMIN,
            moveStatus.CANCELLED_BY_CUSTOMER,
            moveStatus.CANCELLED_BY_DRIVER,
            moveStatus.NO_DRIVERS_AVAILABLE
        ];

        if (terminalStates.includes(currentStatus)) {
            return false; // Cannot transition from a terminal state
        }

        return (flow[currentStatus] && flow[currentStatus].includes(newStatus)) || false;
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
        const isAdmin = userRole === roles.ADMIN;

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

    async getMovesForDriver(driverUserId, options = {}) {
        if (!driverUserId) {
            throw new ApiError('Driver ID is required.', 400);
        }

        const page = options.page * 1 || 1;
        const limit = options.limit * 1 || 10;
        const skip = (page - 1) * limit;

        try {
            const filter = { driver: driverUserId };

            const totalMoves = await Move.countDocuments(filter);
            const totalPages = Math.ceil(totalMoves / limit);

            const moves = await Move.find(filter)
                .populate('customer', 'name email phone image')
                .populate('driver', 'name email phone image')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            return { moves, totalPages, currentPage: page, totalMoves };
        } catch (error) {
            console.error(`Error fetching moves for driver ${driverUserId}:`, error);
            throw new ApiError('Failed to retrieve driver moves.', 500);
        }
    }

    async getMovesForCustomer(customerId, options = {}) {
        if (!customerId) {
            throw new ApiError('Customer ID is required.', 400);
        }

        const page = options.page * 1 || 1;
        const limit = options.limit * 1 || 10;
        const skip = (page - 1) * limit;

        try {
            const filter = { customer: customerId };

            const totalMoves = await Move.countDocuments(filter);
            const totalPages = Math.ceil(totalMoves / limit);

            const moves = await Move.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            return { moves, totalPages, currentPage: page, totalMoves };
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

            if (userRole === roles.CUSTOMER && move.customer._id.toString() === userId) {
                if ([moveStatus.PENDING, moveStatus.ACCEPTED, moveStatus.ARRIVED_AT_PICKUP].includes(move.status)) canCancel = true;
            } else if (userRole === roles.DRIVER && move.driver && move.driver._id.toString() === userId) {
                if ([moveStatus.ACCEPTED, moveStatus.ARRIVED_AT_PICKUP, moveStatus.IN_TRANSIT].includes(move.status)) { // Driver might cancel during transit for emergencies
                    canCancel = true; newStatus = moveStatus.CANCELLED_BY_DRIVER;
                }
            } else if (userRole === roles.ADMIN) {
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
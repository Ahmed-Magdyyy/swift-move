const socketIO = require('socket.io');
const Move = require('../models/moveModel'); // For context like customer/driver IDs from a moveId
const googleMapsService = require('./googleMapsService'); // For any distance calculations
const { moveStatus } = require('../utils/Constant/enum');
const Driver = require('../models/driverModel');

class TrackingService {
    constructor() {
        this.io = null;
        this.driverLocations = new Map();
        this.connectedUsers = new Map();
    }

    /**
     * Initializes the service with a pre-configured Socket.IO server instance.
     * @param {socketIO.Server} io - The Socket.IO server instance.
     */
    initialize(io) {
        if (!io) {
            console.error('[TrackingService] Socket.IO server instance is required for initialization.');
            return;
        }
        this.io = io;
        console.log('[TrackingService] Initialized.');
    }

    registerSocketHandlers(socket) {
        console.log(`[TrackingService] Registering handlers for socket ${socket.id}`);

        // --- Driver-Specific Functionality ---
        socket.on('driver:location_update', async (data) => {
            if (!socket.userId || socket.userRole !== 'driver') {
                return socket.emit('error', { message: 'Authentication required or not a driver.' });
            }

            const driverUserId = socket.userId;
            const { location, moveId } = data; // location is { latitude, longitude }

            if (!location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number' || !moveId) {
                return socket.emit('location_update_error', { message: 'Valid location and moveId are required.' });
            }

            this.driverLocations.set(driverUserId, { location, socketId: socket.id, timestamp: new Date() });

            try {
                const move = await Move.findById(moveId).select('driver customer status delivery').lean();
                if (!move || !move.customer || !move.delivery || !move.delivery.coordinates) {
                    return socket.emit('location_update_error', { message: 'Associated move, customer, or delivery location not found.' });
                }

                const trackableStatuses = [
                    moveStatus.ACCEPTED,
                    moveStatus.ARRIVED_AT_PICKUP,
                    moveStatus.PICKED_UP,
                    moveStatus.ARRIVED_AT_DELIVERY
                ];

                if (trackableStatuses.includes(move.status)) {
                    const remainingDistance = this._calculateDistanceInternal(
                        { lat: location.latitude, lon: location.longitude },
                        { lat: move.delivery.coordinates.coordinates[1], lon: move.delivery.coordinates.coordinates[0] }
                    );

                    this.notifyCustomer(move.customer.toString(), 'customer:driver_location_updated', {
                        driverId: move.driver.toString(),
                        location,
                        moveId,
                        remainingDistance: remainingDistance.toFixed(2) // in kilometers
                    });
                }
            } catch (error) {
                console.error(`[TrackingService] Error processing location update for move ${moveId}:`, error);
                socket.emit('location_update_error', { message: 'An internal error occurred.' });
            }
        });

        socket.on('move:accept_acknowledged_by_server', (data) => {
            if (!socket.userId || socket.userRole !== 'driver') return;
            console.log(`[TrackingService] Driver ${socket.userId} acknowledged accepting move ${data.moveId}`);
        });

        socket.on('move:reject_acknowledged_by_server', (data) => {
            if (!socket.userId || socket.userRole !== 'driver') return;
            console.log(`[TrackingService] Driver ${socket.userId} acknowledged rejecting move ${data.moveId}`);
        });

        socket.on('error', (error) => {
            console.error(`[TrackingService] Socket error from ${socket.id}:`, error);
        });
    }

    async handleDisconnect(socket) {
        if (!socket.userId) return;

        this.driverLocations.delete(socket.userId);

        if (socket.userRole === 'driver') {
            try {
                const updatedDriver = await Driver.findOneAndUpdate(
                    { user: socket.userId, isAvailable: true },
                    { isAvailable: false },
                    { new: true }
                );
                if (updatedDriver) {
                    console.log(`[TrackingService] Driver for user ${socket.userId} automatically set to unavailable due to disconnect.`);
                }
            } catch (error) {
                console.error(`[TrackingService] Error setting driver to unavailable on disconnect for user ${socket.userId}:`, error);
            }
        }
    }

    // --- Notification Methods (Public API for other services) ---

    /**
     * Sends a notification to a specific user's private room.
     * @param {string} userId The ID of the user to notify.
     * @param {string} eventName The name of the socket event.
     * @param {object} data The payload to send.
     */
    notifyUser(userId, eventName, data, userType = 'user') {
        if (!userId || !eventName) {
            console.warn(`[TrackingService] Cannot notify ${userType}: missing ID or eventName`);
            return;
        }

        if (!this.io) {
            console.error('[TrackingService] Socket.IO not initialized');
            return;
        }
        
        const userRoom = `user_${userId}`;
        const roomSockets = this.io.sockets.adapter.rooms.get(userRoom);

        console.log(`[TrackingService] Notifying ${userType} ${userId} in room ${userRoom}`);

        if (!roomSockets || roomSockets.size === 0) {
            // This is a common case (user is offline), so a simple log is fine.
            console.log(`[TrackingService] No active sockets for ${userType} ${userId}. User might be offline.`);
            return;
        }
        
        this.io.to(userRoom).emit(eventName, data);
        console.log(`[TrackingService] Emitted '${eventName}' to ${userType} ${userId}`);
    }

    /**
     * Notifies a specific customer by sending an event to their private room.
     * @param {string} customerId The customer's user ID.
     * @param {string} eventName The event name.
     * @param {object} data The payload.
     */
    notifyCustomer(customerId, eventName, data) {
        this.notifyUser(customerId, eventName, data, 'customer');
    }

    /**
     * Notifies a specific driver by sending an event to their private room.
     * @param {string} driverUserId The driver's user ID.
     * @param {string} eventName The event name.
     * @param {object} data The payload.
     */
    notifyDriver(driverUserId, eventName, data) {
        this.notifyUser(driverUserId, eventName, data, 'driver');
    }

    // --- Internal Helper Methods ---

    /**
     * Calculates the great-circle distance between two points using the Haversine formula.
     * This is a fast, cost-free way to get the straight-line distance ("as the crow flies").
     * @param {{lat: number, lon: number}} point1 - The starting point.
     * @param {{lat: number, lon: number}} point2 - The ending point.
     * @returns {number} The distance in kilometers.
     */
    _calculateDistanceInternal(point1, point2) {
        if (!point1 || !point2) {
            return Infinity;
        }

        const R = 6371; // Radius of the Earth in kilometers
        const dLat = (point2.lat - point1.lat) * (Math.PI / 180);
        const dLon = (point2.lon - point1.lon) * (Math.PI / 180);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(point1.lat * (Math.PI / 180)) * Math.cos(point2.lat * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c; // Distance in km
        return distance;
    }

    /**
     * Retrieves the last known location of a driver.
     * @param {string} driverUserId
     * @returns {object | null} Location object or null.
     */
    getDriverLocation(driverUserId) {
        return this.driverLocations.get(driverUserId)?.location || null;
    }

    /**
     * Checks if a user has an active and authenticated socket connection.
     * @param {string} userId The ID of the user to check.
     * @returns {boolean} True if the user is connected, false otherwise.
     */
    isUserConnected(userId) {
        return this.connectedUsers.has(userId.toString());
    }
}

module.exports = new TrackingService(); 
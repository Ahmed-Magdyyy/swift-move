const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/userModel');
const Move = require('../models/moveModel'); // For context like customer/driver IDs from a moveId
const googleMapsService = require('./googleMapsService'); // For any distance calculations
const { moveStatus } = require('../utils/Constant/enum');
const Driver = require('../models/driverModel');

class TrackingService {
    constructor() {
        this.io = null;
        // Stores current driver locations: driverUserId -> { location: { latitude, longitude }, socketId, timestamp }
        this.driverLocations = new Map();
        // Stores userId -> socketId for quick lookups
        this.connectedUsers = new Map();
    }

    /**
     * Initializes the Socket.IO server and sets up global connection event listeners.
     * @param {http.Server} httpServer - The HTTP server instance.
     */
    initialize(httpServer) {
        if (!httpServer) {
            console.error('[TrackingService] HTTP Server instance is required for initialization.');
            return;
        }
        this.io = socketIO(httpServer, {
            cors: {
                origin: "*", // IMPORTANT: Configure this for your frontend's actual origin in production
                methods: ["GET", "POST"]
            }
        });

        console.log('[TrackingService] Socket.IO initialized and attached to HTTP server.');

        this.io.on('connection', (socket) => {
            console.log(`[TrackingService] Client connected: ${socket.id}`);

            // --- Authentication --- 
            // Verify user token and join them to a private room for targeted notifications
            socket.on('client:authenticate', async (payload) => {
                try {
                    if (!payload || !payload.token) {
                        throw new Error('Authentication token not provided.');
                    }

                    // 1. Verify the token
                    const decoded = await promisify(jwt.verify)(payload.token, process.env.JWT_ACCESS_SECRET);
                    // 2. Check if the user still exists
                    const user = await User.findById(decoded.userId);
                    if (!user) {
                        throw new Error('User not found.');
                    }

                    // 3. Join a private room and store user info on the socket
                    const userRoom = `user_${user._id}`;
                    socket.join(userRoom);
                    socket.userId = user._id.toString();
                    socket.userRole = user.role;
                    this.connectedUsers.set(socket.userId, socket.id); // Add to connected users map

                    console.log(`[TrackingService] Socket ${socket.id} authenticated for user ${socket.userId} (${socket.userRole}) and joined room ${userRoom}`);

                    // 4. Send a success confirmation back to the client
                    socket.emit('authentication_success', { message: `Successfully authenticated as ${socket.userRole} and joined room ${userRoom}` });

                } catch (error) {
                    console.error(`[TrackingService] Authentication failed for socket ${socket.id}:`, error.message);
                    socket.emit('authentication_failed', { error: 'Invalid token or user.' });
                }
            });

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

                // 1. Update in-memory map for real-time ETA calculations
                this.driverLocations.set(driverUserId, { location, socketId: socket.id, timestamp: new Date() });

                // 2. Notify the customer who is actively tracking this move
                try {
                    const move = await Move.findById(moveId).select('driver customer status').lean();

                    if (!move || !move.customer) {
                        return socket.emit('location_update_error', { message: 'Associated move or customer not found.' });
                    }

                    // Only forward location if the move is in an active, trackable state
                    const trackableStatuses = [
                        moveStatus.ACCEPTED,
                        moveStatus.ARRIVED_AT_PICKUP,
                        moveStatus.PICKED_UP,
                        moveStatus.ARRIVED_AT_DELIVERY
                    ];

                    if (trackableStatuses.includes(move.status)) {
                        const customerId = move.customer.toString();

                        // Notify the specific customer in their private room
                        this.notifyUser(customerId, 'customer:driver_location_updated', {
                            driverId: move.driver.toString(),
                            location,
                            moveId
                        });
                    }
                } catch (error) {
                    console.error(`[TrackingService] Error processing location update for move ${moveId}:`, error);
                    socket.emit('location_update_error', { message: 'An internal error occurred.' });
                }
            });

            // --- Disconnection ---
            socket.on('disconnect', async (reason) => {
                console.log(`[TrackingService] Socket ${socket.id} disconnected. Reason: ${reason}`);
                
                if (socket.userId) {
                    this.connectedUsers.delete(socket.userId);
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
            });

            socket.on('error', (error) => {
                console.error(`[TrackingService] Socket error from ${socket.id}:`, error);
            });
        });
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
     * Internal helper to calculate distance.
     * @param {[number, number]} point1 GeoJSON coordinates [longitude, latitude]
     * @param {[number, number]} point2 GeoJSON coordinates [longitude, latitude]
     * @returns {Promise<number>} Distance in meters or Infinity.
     */
    async _calculateDistanceInternal(point1, point2) {
        try {
            if (!googleMapsService || typeof googleMapsService.calculateRoute !== 'function') {
                console.error("[TrackingService] googleMapsService or calculateRoute method is not available.");
                return Infinity;
            }
            if (!Array.isArray(point1) || point1.length !== 2 || !Array.isArray(point2) || point2.length !== 2) {
                console.error('[TrackingService] Invalid points for _calculateDistanceInternal:', point1, point2);
                return Infinity;
            }
            const route = await googleMapsService.calculateRoute(point1, point2);
            return route.distance; // Assuming this returns distance in meters
        } catch (error) {
            console.error('[TrackingService] Error in _calculateDistanceInternal:', error);
            return Infinity;
        }
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
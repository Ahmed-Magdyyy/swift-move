const socketIO = require('socket.io');
const Move = require('../models/moveModel'); // For context like customer/driver IDs from a moveId
const googleMapsService = require('./googleMapsService'); // For any distance calculations


class TrackingService {
    constructor() {
        this.io = null;
        // Stores current driver locations: driverId -> { location: { latitude, longitude }, socketId, timestamp }
        this.driverLocations = new Map();
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

            // --- Generic Room Management ---
            // Allows clients to join arbitrary rooms.
            // Services will dictate meaningful room names (e.g., customer:id, driver:id, move:id)
            socket.on('join_room', (roomName) => {
                if (roomName) {
                    socket.join(roomName);
                    console.log(`[TrackingService] Client ${socket.id} joined room: ${roomName}`);
                    socket.emit('room_joined', { success: true, roomName });
                } else {
                    socket.emit('room_joined', { success: false, message: 'Room name is required.' });
                }
            });

            socket.on('leave_room', (roomName) => {
                if (roomName) {
                    socket.leave(roomName);
                    console.log(`[TrackingService] Client ${socket.id} left room: ${roomName}`);
                    socket.emit('room_left', { success: true, roomName });
                } else {
                    socket.emit('room_left', { success: false, message: 'Room name is required.' });
                }
            });

            // --- Driver-Specific Functionality ---
            socket.on('driver_location_update', async (data) => {
                const { driverId, latitude, longitude, moveId } = data;

                if (!driverId || typeof latitude !== 'number' || typeof longitude !== 'number') {
                    socket.emit('location_update_error', { message: 'Driver ID and valid coordinates are required.' });
                    return;
                }

                const location = { latitude, longitude };
                this.driverLocations.set(driverId, { location, socketId: socket.id, timestamp: new Date() });
                // console.log(`[TrackingService] Driver ${driverId} location updated:`, location);

                // If moveId is provided, notify the specific move room about the driver's new location.
                if (moveId) {
                    this.notifyRoom(`move:${moveId}`, 'driver_location_on_move', { driverId, location, moveId });

                    // Optional: Proximity alerts - this is a simple real-time logic piece
                    try {
                        const move = await Move.findById(moveId).select('customer pickup delivery status').lean();
                        if (move && move.customer) {
                            const customerRoom = `customer:${move.customer.toString()}`;
                            const driverGeoJSONPoint = [longitude, latitude];

                            if (move.status === 'accepted') {
                                if(move.pickup && move.pickup.coordinates && move.pickup.coordinates.coordinates) {
                                    const distanceToPickup = await this._calculateDistanceInternal(driverGeoJSONPoint, move.pickup.coordinates.coordinates);
                                    if (distanceToPickup < 200) { // e.g., 200 meters
                                        this.notifyRoom(customerRoom, 'driver_approaching_pickup', { moveId, distance: distanceToPickup });
                                    }
                                }
                            } else if (move.status === 'in_transit') {
                                 if(move.delivery && move.delivery.coordinates && move.delivery.coordinates.coordinates) {
                                    const distanceToDelivery = await this._calculateDistanceInternal(driverGeoJSONPoint, move.delivery.coordinates.coordinates);
                                    if (distanceToDelivery < 200) { // e.g., 200 meters
                                        this.notifyRoom(customerRoom, 'driver_approaching_delivery', { moveId, distance: distanceToDelivery });
                                    }
                                 }
                            }
                        }
                    } catch(error) {
                        console.error(`[TrackingService] Error in proximity check for move ${moveId}:`, error);
                    }
                }
            });

            // --- Disconnection ---
            socket.on('disconnect', () => {
                console.log(`[TrackingService] Client disconnected: ${socket.id}`);
                // Optional: Remove driver from driverLocations if their socket matches.
                // This needs careful handling if a driver can have multiple connections or quick reconnections.
                for (const [driverId, data] of this.driverLocations.entries()) {
                    if (data.socketId === socket.id) {
                        // this.driverLocations.delete(driverId); // Or mark as inactive
                        // console.log(`[TrackingService] Cleaned up location for driver ${driverId} on disconnect.`);
                        break;
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
     * Emits an event to all clients in a specific room.
     * @param {string} roomName - The target room.
     * @param {string} eventName - The event to emit.
     * @param {object} data - The payload for the event.
     */
    notifyRoom(roomName, eventName, data) {
        if (this.io && roomName && eventName) {
            // console.log(`[TrackingService] Notifying room '${roomName}', Event: '${eventName}', Data:`, data);
            this.io.to(roomName).emit(eventName, data);
        } else {
            console.warn(`[TrackingService] Failed to notify room. IO ready: ${!!this.io}, Room: ${roomName}, Event: ${eventName}`);
        }
    }

    /**
     * Convenience method to notify a specific customer.
     * Joins/emits to `customer:<customerId>` room.
     */
    notifyCustomer(customerId, eventName, data) {
        if (customerId) {
            this.notifyRoom(`customer:${customerId}`, eventName, data);
        } else {
            console.warn(`[TrackingService] notifyCustomer: customerId is required.`);
        }
    }

    /**
     * Convenience method to notify a specific driver.
     * Joins/emits to `driver:<driverId>` room.
     */
    notifyDriver(driverId, eventName, data) {
        if (driverId) {
            this.notifyRoom(`driver:${driverId}`, eventName, data);
        } else {
            console.warn(`[TrackingService] notifyDriver: driverId is required.`);
        }
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
            // Ensure points are valid arrays of two numbers
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
     * @param {string} driverId
     * @returns {object | null} Location object or null.
     */
    getDriverLocation(driverId) {
        return this.driverLocations.get(driverId)?.location || null;
    }
}

module.exports = new TrackingService(); 
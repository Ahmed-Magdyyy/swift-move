const socketIO = require('socket.io');
const Move = require('../models/moveModel');
const googleMapsService = require('./googleMapsService');

class TrackingService {
    constructor() {
        this.io = null;
        this.activeMoves = new Map(); // Map of moveId -> socketId
        this.driverLocations = new Map(); // Map of driverId -> location
    }

    initialize(server) {
        this.io = socketIO(server);

        this.io.on('connection', (socket) => {
            console.log('Client connected:', socket.id);

            // Driver joins their room
            socket.on('driver:join', (driverId) => {
                socket.join(`driver:${driverId}`);
            });

            // Customer joins their room
            socket.on('customer:join', (customerId) => {
                socket.join(`customer:${customerId}`);
            });

            // Driver updates their location
            socket.on('driver:location', async (data) => {
                const { driverId, moveId, location } = data;
                
                // Update driver's location
                this.driverLocations.set(driverId, location);

                // Get move details
                const move = await Move.findById(moveId);
                if (!move) return;

                // Emit location update to customer
                this.io.to(`customer:${move.customer}`).emit('driver:location', {
                    moveId,
                    location,
                    driverId
                });

                // If driver is near pickup/delivery, notify customer
                if (move.status === 'accepted') {
                    const distanceToPickup = await this.calculateDistance(
                        location,
                        move.pickup.coordinates.coordinates
                    );
                    if (distanceToPickup < 100) { // within 100 meters
                        this.io.to(`customer:${move.customer}`).emit('driver:nearby', {
                            moveId,
                            type: 'pickup'
                        });
                    }
                } else if (move.status === 'in_transit') {
                    const distanceToDelivery = await this.calculateDistance(
                        location,
                        move.delivery.coordinates.coordinates
                    );
                    if (distanceToDelivery < 100) { // within 100 meters
                        this.io.to(`customer:${move.customer}`).emit('driver:nearby', {
                            moveId,
                            type: 'delivery'
                        });
                    }
                }
            });

            // Customer starts tracking a move
            socket.on('move:track', (moveId) => {
                socket.join(`move:${moveId}`);
            });

            // Driver accepts a move
            socket.on('move:accept', async (data) => {
                const { moveId, driverId } = data;
                const move = await Move.findById(moveId);
                
                if (move) {
                    move.driver = driverId;
                    move.status = 'accepted';
                    await move.save();

                    // Notify customer
                    this.io.to(`customer:${move.customer}`).emit('move:accepted', {
                        moveId,
                        driverId
                    });
                }
            });

            // Driver rejects a move
            socket.on('move:reject', async (data) => {
                const { moveId, driverId, reason } = data;
                const move = await Move.findById(moveId);
                
                if (move) {
                    // Notify customer
                    this.io.to(`customer:${move.customer}`).emit('move:rejected', {
                        moveId,
                        driverId,
                        reason
                    });
                }
            });

            // Handle disconnection
            socket.on('disconnect', () => {
                console.log('Client disconnected:', socket.id);
                // Clean up any active moves or driver locations
                for (const [moveId, socketId] of this.activeMoves.entries()) {
                    if (socketId === socket.id) {
                        this.activeMoves.delete(moveId);
                    }
                }
            });
        });
    }

    // Calculate distance between two points
    async calculateDistance(point1, point2) {
        try {
            const route = await googleMapsService.calculateRoute(point1, point2);
            return route.distance;
        } catch (error) {
            console.error('Error calculating distance:', error);
            return Infinity;
        }
    }

    // Emit move status update to all relevant parties
    async emitMoveStatusUpdate(moveId, status) {
        const move = await Move.findById(moveId)
            .populate('customer', '_id')
            .populate('driver', '_id');

        if (move) {
            const update = { moveId, status };
            
            // Notify customer
            this.io.to(`customer:${move.customer._id}`).emit('move:status', update);
            
            // Notify driver
            if (move.driver) {
                this.io.to(`driver:${move.driver._id}`).emit('move:status', update);
            }
        }
    }
}

module.exports = new TrackingService(); 
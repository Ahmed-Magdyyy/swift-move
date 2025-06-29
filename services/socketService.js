const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

class SocketService {
    initialize(io, services) {
        const { chatService, trackingService } = services;

        // Initialize the services that this master service will manage
        chatService.initialize(io);
        trackingService.initialize(io);

        io.on('connection', (socket) => {
            console.log(`[SocketService] New client connected: ${socket.id}`);

            // Set a timeout for authentication
            const authTimeout = setTimeout(() => {
                if (!socket.userId) {
                    console.log(`[SocketService] Disconnecting socket ${socket.id} due to authentication timeout.`);
                    socket.disconnect(true);
                }
            }, 10000); // 10 seconds

            // Handle the one-time authentication event
            socket.once('client:authenticate', async (payload) => {
                try {
                    clearTimeout(authTimeout); // Clear the timeout as authentication was attempted

                    if (!payload || !payload.token) {
                        throw new Error('Authentication token not provided.');
                    }

                    const decoded = await promisify(jwt.verify)(payload.token, process.env.JWT_ACCESS_SECRET);
                    const user = await User.findById(decoded.userId);
                    if (!user) {
                        throw new Error('User not found.');
                    }

                    // Attach user info to the socket
                    socket.userId = user._id.toString();
                    socket.userRole = user.role;
                    const userRoom = `user_${socket.userId}`;
                    // Join a private room for user-specific notifications
                    socket.join(userRoom);
                    trackingService.connectedUsers.set(socket.userId, socket.id);

                    console.log(`[SocketService] Socket ${socket.id} authenticated for user ${socket.userId} (${socket.userRole}).`);

                    // Register the business-logic handlers from other services
                    trackingService.registerSocketHandlers(socket);
                    chatService.registerSocketHandlers(socket);

                    console.log(`[SocketService] Socket ${socket.id} authenticated for user ${socket.userId} (${socket.userRole}) and joined room ${userRoom}`);

                    socket.emit('authentication_success', { 
                        message: `Successfully authenticated as ${socket.userRole}.`,
                        userId: socket.userId,
                        role: socket.userRole
                    });

                } catch (error) {
                    console.error(`[SocketService] Authentication failed for socket ${socket.id}:`, error.message);
                    socket.emit('authentication_failed', { error: 'Invalid token or user authentication failed.' });
                    socket.disconnect(true);
                    console.log(`[SocketService] Socket ${socket.id} disconnected due to authentication failure.`);
                }
            });

            // Handle disconnection
            socket.on('disconnect', (reason) => {
                console.log(`[SocketService] Client disconnected: ${socket.id} , reason: ${reason}`);
                if (socket.userId) {
                    // Handle disconnection in all relevant services
                    trackingService.connectedUsers.delete(socket.userId);
                    trackingService.handleDisconnect(socket);
                    chatService.handleDisconnect(socket);
                }
            });
        });

        console.log('[SocketService] Initialized and listening for connections.');
    }
}

module.exports = new SocketService();

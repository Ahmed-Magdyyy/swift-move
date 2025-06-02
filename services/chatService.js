const socketIO = require('socket.io');
const Move = require('../models/moveModel');

class ChatService {
    constructor() {
        this.io = null;
        this.activeChats = new Map(); // Map of moveId -> Set of participant socketIds
    }

    initialize(io) {
        this.io = io;

        this.io.on('connection', (socket) => {
            // Join move chat room
            socket.on('chat:join', (moveId) => {
                socket.join(`chat:${moveId}`);
                if (!this.activeChats.has(moveId)) {
                    this.activeChats.set(moveId, new Set());
                }
                this.activeChats.get(moveId).add(socket.id);
            });

            // Send message
            socket.on('chat:message', async (data) => {
                const { moveId, message, senderId } = data;
                
                // Verify sender is part of the move
                const move = await Move.findById(moveId);
                if (!move) return;

                if (move.customer.toString() !== senderId && 
                    move.driver?.toString() !== senderId) {
                    return;
                }

                // Broadcast message to chat room
                this.io.to(`chat:${moveId}`).emit('chat:message', {
                    moveId,
                    message,
                    senderId,
                    timestamp: new Date()
                });
            });

            // Handle disconnection
            socket.on('disconnect', () => {
                // Remove socket from active chats
                for (const [moveId, sockets] of this.activeChats.entries()) {
                    if (sockets.has(socket.id)) {
                        sockets.delete(socket.id);
                        if (sockets.size === 0) {
                            this.activeChats.delete(moveId);
                        }
                    }
                }
            });
        });
    }

    // Get active participants for a move
    getActiveParticipants(moveId) {
        return this.activeChats.get(moveId)?.size || 0;
    }
}

module.exports = new ChatService(); 
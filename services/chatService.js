const Conversation = require('../models/conversationModel');
const Message = require('../models/messageModel');
const ApiError = require('../utils/ApiError');
const User = require('../models/userModel');
const trackingService = require('./trackingService');

class ChatService {
    /**
     * Sends a notification to a specific user if they are connected.
     * @param {string} userId - The ID of the user to notify.
     * @param {string} event - The WebSocket event name.
     * @param {object} payload - The data to send.
     */
    notifyUser(userId, event, payload) {
        const socketId = trackingService.connectedUsers.get(userId.toString());
        if (socketId) {
            this.io.to(socketId).emit(event, payload);
        }
    }
    constructor() {
        this.io = null;
        this.activeChats = new Map(); // Map of moveId -> Set of participant socketIds
    }

    initialize(io) {
        if (!io) {
            console.error('[ChatService] Socket.IO server instance is required for initialization.');
            return;
        }
        this.io = io;
        console.log('[ChatService] Initialized.');
    }

    registerSocketHandlers(socket) {
        console.log(`[ChatService] Registering handlers for socket ${socket.id}`);

        socket.on('client:join_chat_room', (payload) => {
            if (!socket.userId) return; // Must be authenticated
            const { conversationId } = payload;
            if (conversationId) {
                // TODO: Verify user is a participant before allowing them to join
                const roomName = `chat_${conversationId}`;
                socket.join(roomName);
                console.log(`[ChatService] User ${socket.userId} joined room ${roomName}`);
            }
        });

        socket.on('client:send_message', async (payload) => {
            if (!socket.userId) return; // Must be authenticated
            const { conversationId, content } = payload;
            if (conversationId && content) {
                try {
                    await this.sendMessage(socket.userId, conversationId, content);
                } catch (error) {
                    socket.emit('server:error', { message: error.message });
                }
            }
        });
    }

    handleDisconnect(socket) {
        // On disconnect, remove the socket from any active chat rooms it was in
        for (const [moveId, sockets] of this.activeChats.entries()) {
            if (sockets.has(socket.id)) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    this.activeChats.delete(moveId);
                }
                console.log(`[ChatService] Removed socket ${socket.id} from active chat for move ${moveId}`);
            }
        }
    }

    // Get active participants for a move
    getActiveParticipants(moveId) {
        return this.activeChats.get(moveId)?.size || 0;
    }

    /**
     * Get all conversations for a specific user, sorted by the most recent activity.
     * @param {string} userId - The ID of the user.
     * @returns {Promise<Array>} - A promise that resolves to an array of conversations.
     */
    async getMyConversations(userId) {
        const conversations = await Conversation.find({ participants: userId })
            .populate({
                path: 'participants',
                select: 'name image', // Select fields to return for participants
            })
            .populate({
                path: 'lastMessage',
                populate: {
                    path: 'sender',
                    select: 'name',
                },
            })
            .sort({ updatedAt: -1 });

        // Format conversations to be more client-friendly
        const formattedConversations = conversations.map(convo => {
            const conversationObject = convo.toObject();
            // Filter out the current user from the participants list to easily display the 'other' user
            conversationObject.participants = conversationObject.participants.filter(
                p => p._id.toString() !== userId.toString()
            );
            return conversationObject;
        });

        return formattedConversations;
    }

    /**
     * Get all messages for a specific conversation with pagination.
     * @param {string} userId - The ID of the user making the request.
     * @param {string} conversationId - The ID of the conversation.
     * @param {object} paginationOptions - Options for pagination (e.g., { page, limit }).
     * @returns {Promise<Array>} - A promise that resolves to an array of messages.
     */
    async getMessagesForConversation(userId, conversationId, paginationOptions = {}) {
        // 1. Find the conversation and verify the user is a participant
        const conversation = await Conversation.findById(conversationId);

        if (!conversation) {
            throw new ApiError('Conversation not found', 404);
        }

        if (!conversation.participants.includes(userId)) {
            throw new ApiError('You are not authorized to view this conversation', 403);
        }

        // 2. Fetch messages with pagination
        const page = parseInt(paginationOptions.page, 10) || 1;
        const limit = parseInt(paginationOptions.limit, 10) || 50; // Default to 50 messages
        const skip = (page - 1) * limit;

        const messages = await Message.find({ conversationId })
            .populate({
                path: 'sender',
                select: 'name image',
            })
            .sort({ createdAt: 'asc' })
            .skip(skip)
            .limit(limit);

        return messages;
    }

    async _findBestAdminForSupport() {
        // Get online user IDs from the singleton trackingService instance
        const onlineUserIds = [...trackingService.connectedUsers.keys()];

        // Find online admins with chat enabled
        let candidateAdmins = await User.find({
            _id: { $in: onlineUserIds },
            role: 'admin',
            enabledControls: 'chat'
        }).select('_id').lean();

        // Fallback if no admins are online
        if (candidateAdmins.length === 0) {
            candidateAdmins = await User.find({
                role: 'admin',
                enabledControls: 'chat'
            }).select('_id').lean();
        }

        if (candidateAdmins.length === 0) {
            // No support agents are configured in the system at all
            throw new ApiError('Support service is currently unavailable.', 503);
        }

        // Find the admin with the least number of open chats
        const chatCounts = await Promise.all(
            candidateAdmins.map(async (admin) => {
                const count = await Conversation.countDocuments({
                    participants: admin._id,
                    type: 'support',
                    status: 'open'
                });
                return { adminId: admin._id, count };
            })
        );
        
        const minCount = Math.min(...chatCounts.map(c => c.count));
        const leastBusyAdmins = chatCounts.filter(c => c.count === minCount);

        // Randomly select one from the least busy admins
        const chosenAdmin = leastBusyAdmins[Math.floor(Math.random() * leastBusyAdmins.length)];

        return chosenAdmin.adminId;
    }

    async findOrCreateSupportConversation(userId, initialMessageContent) {
        // 1. Check for an existing open support chat for this user
        let conversation = await Conversation.findOne({
            participants: userId,
            type: 'support',
            status: 'open'
        });

        if (conversation) {
            // If a chat already exists, return it instead of creating a new one
            return conversation;
        }

        // 2. If no open chat, find the best admin to assign a new one to
        const adminId = await this._findBestAdminForSupport();

        // 3. Create the new conversation
        conversation = await Conversation.create({
            participants: [userId, adminId],
            type: 'support',
            status: 'open'
        });

        // 4. If there's an initial message, create it and link it to the conversation
        if (initialMessageContent && initialMessageContent.trim() !== '') {
            const message = await Message.create({
                conversationId: conversation._id,
                sender: userId,
                content: initialMessageContent.trim()
            });
            conversation.lastMessage = message._id;
            await conversation.save();
        }

        // 5. Notify the assigned admin in real-time
        this.notifyUser(adminId, 'server:new_support_chat', conversation);

        return conversation;
    }

    async sendMessage(senderId, conversationId, content) {
        // 1. Find the conversation and verify the sender is a participant
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            throw new ApiError('Conversation not found', 404);
        }
        if (!conversation.participants.map(p => p.toString()).includes(senderId)) {
            throw new ApiError('You are not authorized to send messages in this conversation', 403);
        }

        // 2. Create the new message
        const message = await Message.create({
            conversationId,
            sender: senderId,
            content: content.trim(),
        });

        // 3. Update the conversation's lastMessage and timestamp
        conversation.lastMessage = message._id;
        await conversation.save();

        // 4. Broadcast the new message to all participants in the room
        const roomName = `chat_${conversationId}`;
        const populatedMessage = await Message.findById(message._id).populate('sender', 'name image');
        this.io.to(roomName).emit('server:new_message', populatedMessage);

        return populatedMessage;
    }
}

module.exports = new ChatService(); 
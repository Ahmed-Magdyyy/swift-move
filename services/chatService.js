const Conversation = require('../models/conversationModel');
const Message = require('../models/messageModel');
const Move = require('../models/moveModel');
const ApiError = require('../utils/ApiError');
const User = require('../models/userModel');
const trackingService = require('./trackingService');

class ChatService {
    constructor() {
        this.io = null;
    }

    /**
     * Initializes the service with a pre-configured Socket.IO server instance.
     * @param {socketIO.Server} io - The Socket.IO server instance.
     */
    initialize(io) {
        if (!io) {
            console.error('[ChatService] Socket.IO server instance is required for initialization.');
            return;
        }
        this.io = io;
        console.log('[ChatService] Initialized.');
    }

    /**
     * Registers all chat-related event handlers for a given socket.
     * @param {Socket} socket - The socket instance for a connected client.
     */
    configureSocketForChat(socket) {

        // Handler for a client wanting to join a chat room for a specific conversation
        socket.on('chat:join', async (payload) => {
            if (!socket.userId) {
                return socket.emit('server:error', { message: 'Authentication required.' });
            }
            const { conversationId } = payload;
            if (!conversationId) {
                return socket.emit('server:error', { message: 'Conversation ID is required.' });
            }

            try {
                // 1. Find the conversation and the associated move
                const conversation = await Conversation.findById(conversationId).populate({
                    path: 'move',
                    select: 'customer driver'
                });

                if (!conversation || !conversation.move) {
                    return socket.emit('server:error', { message: 'Associated move for this chat not found.' });
                }

                // 2. Verify the user is the customer or the driver for the move
                const { customer, driver } = conversation.move;
                const userId = socket.userId.toString();

                if (userId !== customer.toString() && userId !== driver.toString()) {
                    return socket.emit('server:error', { message: 'You are not authorized to join this chat.' });
                }

                // 3. Join the socket to the room
                const room = `conversation_${conversationId}`;
                socket.join(room);

                console.log(`[ChatService] User ${userId} joined chat for conversation ${conversationId}`);
                socket.emit('chat:joined', { conversationId });

            } catch (error) {
                console.error(`[ChatService] Error joining chat for conversation ${conversationId}:`, error);
                socket.emit('server:error', { message: 'An error occurred while joining the chat.' });
            }
        });

        // Handler for sending a message
        socket.on('chat:send_message', async (payload) => {
            if (!socket.userId) {
                return socket.emit('server:error', { message: 'Authentication required.' });
            }

            const { conversationId, content } = payload;
            if (!conversationId || !content) {
                return socket.emit('server:error', { message: 'Conversation ID and message content are required.' });
            }

            try {
                // 1. Verify the conversation exists and the user is a participant (re-check for security)
                const conversation = await Conversation.findById(conversationId).populate({ path: 'move', select: 'customer driver' });
                if (!conversation || !conversation.move) {
                    return socket.emit('server:error', { message: 'Conversation not found.' });
                }

                const { customer, driver } = conversation.move;
                const userId = socket.userId.toString();

                if (userId !== customer.toString() && userId !== driver.toString()) {
                    return socket.emit('server:error', { message: 'You are not authorized to send messages in this chat.' });
                }

                // 2. Create and save the new message
                const message = new Message({
                    conversation: conversationId,
                    sender: userId,
                    content: content
                });
                await message.save();

                // 3. Broadcast the message to the room
                const room = `conversation_${conversationId}`;
                this.io.to(room).emit('chat:new_message', {
                    _id: message._id,
                    conversation: message.conversation,
                    sender: message.sender,
                    content: message.content,
                    createdAt: message.createdAt
                });

                console.log(`[ChatService] Message sent by ${userId} in conversation ${conversationId}`);

            } catch (error) {
                console.error(`[ChatService] Error sending message in conversation ${conversationId}:`, error);
                socket.emit('server:error', { message: 'An error occurred while sending the message.' });
            }
        });

        // Handler for when a user starts typing
        socket.on('chat:typing', (payload) => {
            const { conversationId } = payload;
            if (conversationId && socket.userId) {
                const room = `conversation_${conversationId}`;
                socket.to(room).emit('chat:typing', { userId: socket.userId });
            }
        });

        // Handler for when a user stops typing
        socket.on('chat:stop_typing', (payload) => {
            const { conversationId } = payload;
            if (conversationId && socket.userId) {
                const room = `conversation_${conversationId}`;
                socket.to(room).emit('chat:stop_typing', { userId: socket.userId });
            }
        });
    }

    /**
     * Handles cleanup when a socket disconnects.
     * This can be used for presence management in the future.
     * @param {Socket} socket - The disconnected socket instance.
     */
    handleDisconnect(socket) {
        // In the future, we could manage user's online status in different conversations here
        console.log(`[ChatService] Handling disconnect for socket ${socket.id}`);
    }

    /**
     * Get all conversations for a specific user.
     * @param {string} userId - The ID of the user.
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
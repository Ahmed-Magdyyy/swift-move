const asyncHandler = require('express-async-handler');
const chatService = require('../services/chatService');
const ApiError = require('../utils/ApiError');

// @desc    Get all conversations for the logged-in user
// @route   GET /api/v1/chats
// @access  Private
exports.getMyConversations = asyncHandler(async (req, res, next) => {
    const conversations = await chatService.getMyConversations(req.user._id);
    res.status(200).json({
        status: 'success',
        results: conversations.length,
        data: conversations,
    });
});

// @desc    Get all messages for a specific conversation
// @route   GET /api/v1/chats/:conversationId/messages
// @access  Private (Participants only)
exports.getMessagesForConversation = asyncHandler(async (req, res, next) => {
    const { conversationId } = req.params;
    const { page, limit } = req.query;

    const messages = await chatService.getMessagesForConversation(
        req.user._id,
        conversationId,
        { page, limit }
    );

    res.status(200).json({
        status: 'success',
        results: messages.length,
        data: messages,
    });
});

// @desc    Create a new support conversation
// @route   POST /api/v1/chats/support
// @access  Private (Customer or Driver)
exports.createSupportConversation = asyncHandler(async (req, res, next) => {
    const { message } = req.body; // The initial message is optional

    const conversation = await chatService.findOrCreateSupportConversation(
        req.user._id,
        message
    );

    res.status(201).json({
        status: 'success',
        data: conversation,
    });
});

// @desc    Send a message in a conversation
// @route   POST /api/v1/chats/:conversationId/messages
// @access  Private (Participants only)
exports.sendMessage = asyncHandler(async (req, res, next) => {
    const { conversationId } = req.params;
    const { content } = req.body;

    if (!content) {
        return next(new ApiError('Message content is required', 400));
    }

    const message = await chatService.sendMessage(
        req.user._id,
        conversationId,
        content
    );

    res.status(201).json({
        status: 'success',
        data: message,
    });
});

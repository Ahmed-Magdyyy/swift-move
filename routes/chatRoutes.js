const express = require('express');
const router = express.Router();
const {
    getMyConversations,
    getMessagesForConversation,
    createSupportConversation,
    sendMessage,
} = require('../controllers/chatController');
const { protect, allowedTo } = require('../controllers/authController');

// All routes below are protected
router.use(protect);

// Get all conversations for the current user
router.get('/', getMyConversations);

// Create a new support chat
router.post('/support', allowedTo('customer', 'driver'), createSupportConversation);

// Get all messages for a specific conversation
router.get('/:conversationId/messages', getMessagesForConversation);

// Send a message (might be primarily WebSocket-based)
router.post('/:conversationId/messages', sendMessage);

module.exports = router;

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    }],
    type: {
        type: String,
        enum: ['in-move', 'support'],
        required: true,
    },
    relatedMoveId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Move',
        // This is not required because support chats don't have a moveId
    },
    lastMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
    },
    status: {
        type: String,
        enum: ['open', 'closed'],
        default: 'open',
        required: true,
    },
}, { timestamps: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation;

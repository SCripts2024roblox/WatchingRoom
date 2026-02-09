const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static('public'));

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store connected users and state
const users = new Map();
const messages = {
    general: []
};
let currentMedia = {
    url: '',
    type: '',
    timestamp: Date.now()
};

// Broadcast to all clients
function broadcast(data, excludeId = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === 1 && client.userId !== excludeId) {
            client.send(message);
        }
    });
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());

            switch (message.type) {
                case 'join':
                    // User joined
                    ws.userId = message.user.id;
                    users.set(message.user.id, message.user);
                    
                    // Send current state to new user
                    ws.send(JSON.stringify({
                        type: 'init',
                        users: Array.from(users.values()),
                        messages: messages,
                        currentMedia: currentMedia
                    }));

                    // Notify others
                    broadcast({
                        type: 'user-joined',
                        user: message.user
                    }, ws.userId);

                    console.log(`User ${message.user.nickname} joined`);
                    break;

                case 'message':
                    // Store message
                    const chatId = message.chatId || 'general';
                    if (!messages[chatId]) {
                        messages[chatId] = [];
                    }
                    messages[chatId].push(message.message);

                    // Limit message history
                    if (messages[chatId].length > 100) {
                        messages[chatId] = messages[chatId].slice(-100);
                    }

                    // Broadcast message
                    if (chatId === 'general') {
                        broadcast({
                            type: 'message',
                            chatId: chatId,
                            message: message.message
                        });
                    } else {
                        // Private message - send only to participants
                        const participants = chatId.split('_').filter(id => id !== 'private');
                        participants.forEach(userId => {
                            const userWs = Array.from(wss.clients).find(client => client.userId === userId);
                            if (userWs && userWs.readyState === 1) {
                                userWs.send(JSON.stringify({
                                    type: 'message',
                                    chatId: chatId,
                                    message: message.message
                                }));
                            }
                        });
                    }
                    break;

                case 'media-update':
                    // Update current media
                    currentMedia = {
                        url: message.url,
                        type: message.mediaType,
                        timestamp: Date.now(),
                        updatedBy: ws.userId
                    };

                    // Broadcast to all
                    broadcast({
                        type: 'media-update',
                        media: currentMedia
                    });

                    console.log(`Media updated: ${message.url}`);
                    break;

                case 'typing':
                    // Broadcast typing indicator
                    broadcast({
                        type: 'typing',
                        userId: ws.userId,
                        chatId: message.chatId,
                        isTyping: message.isTyping
                    }, ws.userId);
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    ws.on('close', () => {
        if (ws.userId) {
            const user = users.get(ws.userId);
            users.delete(ws.userId);

            // Notify others
            broadcast({
                type: 'user-left',
                userId: ws.userId,
                nickname: user ? user.nickname : 'Unknown'
            });

            console.log(`User ${user ? user.nickname : ws.userId} disconnected`);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        users: users.size,
        uptime: process.uptime()
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📺 Open http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

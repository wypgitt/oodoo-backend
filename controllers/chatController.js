const { db } = require('../config/firebase');

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join gig-specific chat room
    socket.on('joinGigChat', (gigId) => {
      socket.join(gigId);
      // Fetch and emit message history from Firestore
      db.collection(`chats/${gigId}/messages`)
        .orderBy('timestamp')
        .get()
        .then((snapshot) => {
          const messages = snapshot.docs.map(doc => doc.data());
          socket.emit('chatHistory', messages);
        });
    });

    // Send message
    socket.on('sendMessage', async ({ gigId, userId, message }) => {
      const msgData = { userId, message, timestamp: new Date() };
      await db.collection(`chats/${gigId}/messages`).add(msgData);
      io.to(gigId).emit('newMessage', msgData);  // Broadcast
    });

    // Typing indicator
    socket.on('typing', ({ gigId, userId }) => {
      socket.to(gigId).emit('userTyping', userId);
    });

    socket.on('disconnect', () => console.log('User disconnected'));
  });
};
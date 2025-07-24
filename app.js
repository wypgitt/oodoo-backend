const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const { db } = require('./config/firebase');  // Test connection

const userRoutes = require('./routes/users');
const gigRoutes = require('./routes/gigs');
const mailboxRoutes = require('./routes/mailbox');
const chatController = require('./controllers/chatController');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*' }  // Adjust for production
});

app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/gigs', gigRoutes);
app.use('/api/mailbox', mailboxRoutes);

app.use((req, res, next) => {
  console.log('Request Body:', req.body);  // Debug log
  next();
});
app.use(bodyParser.json());
app.use('/api/users', userRoutes);

// Socket.io for chat
chatController(io);

// Health check
app.get('/', (req, res) => res.send('Oodoo Backend Running'));

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
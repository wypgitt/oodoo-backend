const jwt = require('jsonwebtoken');
require('dotenv').config();

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });
    console.log('Decoded JWT payload:', decoded);  // Add this for debug
    req.userId = decoded.userId;
    if (!req.userId) {
      return res.status(403).json({ message: 'User ID missing in token payload' });
    }
    next();
  });
};

module.exports = verifyToken;

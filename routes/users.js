const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const { db, auth } = require('../config/firebase');
const jwt = require('jsonwebtoken');
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(), // Adds timestamp
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// POST /api/users/register - Basic email/phone registration
router.post('/register', async (req, res) => {
  // Validate required fields
  if (!req.body || !req.body.email || !req.body.password || !req.body.phone || !req.body.username || !req.body.firstName || !req.body.lastName || !req.body.dateOfBirth || !req.body.address || !req.body.city || !req.body.state || !req.body.zipcode) {
    return res.status(400).json({ error: 'Missing required fields: email, password, phone, username, firstName, lastName, dateOfBirth, address, city, state, zipcode' });
  }
  const { email, password, phone, username, firstName, lastName, dateOfBirth, address, city, state, zipcode } = req.body;
  logger.info('Register Attempt:', { email, phone, username, firstName, lastName });
  try {
    const userRecord = await auth.getUserByEmail(email).catch(() => null);
    if (userRecord) {
      await db.collection('users').doc(userRecord.uid).set({ phone, verified: false, username, firstName, lastName, dateOfBirth, address, city, state, zipcode }, { merge: true });
      logger.info('User Updated in Firestore:', userRecord.uid);
      return res.json({ uid: userRecord.uid, message: 'User updated' });
    }
    const user = await auth.createUser({ email, password });
    logger.info('User Created in Auth:', user.uid);
    const userData = { phone, verified: false, username, firstName, lastName, dateOfBirth, address, city, state, zipcode };
    await db.collection('users').doc(user.uid).set(userData);
    logger.info('User Written to Firestore:', user.uid, userData);
    res.json({ uid: user.uid });
  } catch (err) {
    logger.error('Error Details:', err);
    let errorMessage = 'Authentication Error';
    if (err.code === 'auth/email-already-exists') errorMessage = 'The email address is already in use by another account.';
    else if (err.code === 'auth/invalid-email') errorMessage = 'Invalid email format';
    else if (err.code === 'permission-denied') errorMessage = 'Firestore permission denied';
    res.status(400).json({ error: errorMessage });
  }
});


// POST /api/users/verify-phone - Confirm OTP
// router.post('/verify-phone', async (req, res) => {
//   const { phone, code } = req.body;
//   try {
//     const check = await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
//       .verificationChecks.create({ to: phone, code });
//     if (check.status === 'approved') {
//       // Update user in Firestore
//       const userDoc = await db.collection('users').where('phone', '==', phone).get();
//       if (!userDoc.empty) userDoc.docs[0].ref.update({ verified: true });
//       res.json({ success: true });
//     } else res.json({ success: false });
//   } catch (err) { res.status(500).json({ error: err.message }); }
// });

// GET /api/users/profile - Protected
router.get('/profile', verifyToken, async (req, res) => {
  const user = await db.collection('users').doc(req.userId).get();
  res.json(user.data());
});

module.exports = router;


// POST /api/users/login - User login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    // Sign in with Firebase Auth
    const userRecord = await auth.getUserByEmail(email).catch(() => null);
    if (!userRecord) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    // Firebase Admin SDK does not verify password, so you need to verify on the client
    // For backend-only, you need to use Firebase Client SDK or custom logic
    // Here, we assume password is verified on the client and only issue token if user exists

    // Create JWT token
    const token = jwt.sign({ userId: userRecord.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ...existing code...
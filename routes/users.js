const express = require('express');
const router = express.Router();
const { db, auth } = require('../config/firebase');
const jwt = require('jsonwebtoken');
const winston = require('winston');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const verifyToken = require('../middleware/auth');
const nodemailer = require('nodemailer');  // New: For sending custom emails
const validate = require('../middleware/validate');  // Assuming from prior step
const Joi = require('joi');  // For enhanced validation
const logger = require('../logger');


// Rate limiter to prevent brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many login attempts. Please try again later.'
});

// Joi schema (from prior; enhanced with DOB format)
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),  // Improved: Min length 8 for better security
  phoneNumber: Joi.string().pattern(/^\+[1-9]\d{1,14}$/).required(),  // E.164 format
  username: Joi.string().alphanum().min(3).max(30).required(),
  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  dateOfBirth: Joi.date().iso().required(),  // Ensure ISO format
  address: Joi.string().required(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  zipcode: Joi.string().required(),
  name: Joi.string().optional(),
  accountType: Joi.string().valid('individual', 'business').default('individual')
});

// Helper to calculate age
const calculateAge = (dob) => {
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

// Helper to send verification email
async function sendVerificationEmail(email, link) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,  // e.g., 'smtp.gmail.com'
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: '"Oodoo" <no-reply@oodoo.com>',
    to: email,
    subject: 'Verify Your Email for Oodoo',
    html: `<p>Hello,</p><p>Please verify your email by clicking <a href="${link}">here</a>.</p><p>If you didn't request this, ignore it.</p>`
  });
}

// POST /api/users/register
router.post('/register', validate(registerSchema), async (req, res) => {
  const { email, password, phoneNumber, username, firstName, lastName, dateOfBirth, address, city, state, zipcode, name, accountType } = req.body;
  logger.info('Register Attempt:', { email, phoneNumber, username, firstName, lastName });

  try {
    // Manual safeguard: Check for undefined in query values (shouldn't hit if validation works)
    if (!username || !phoneNumber) {
      return res.status(400).json({ error: 'Username and phone number are required' });
    }

    // Age check
    const age = calculateAge(dateOfBirth);
    if (age < 18) {
      return res.status(400).json({ error: 'You must be at least 18 years old to register' });
    }

    // Uniqueness checks
    const usernameQuery = await db.collection('users').where('username', '==', username).get();
    const phoneQuery = await db.collection('users').where('phoneNumber', '==', phoneNumber).get();

    const userRecord = await auth.getUserByEmail(email).catch(() => null);

    // Determine displayName
    const displayName = name || `${firstName} ${lastName}`;

    if (userRecord) {
      // Update mode
      if (!usernameQuery.empty && usernameQuery.docs[0].id !== userRecord.uid) {
        return res.status(400).json({ error: 'Username already in use' });
      }
      if (!phoneQuery.empty && phoneQuery.docs[0].id !== userRecord.uid) {
        return res.status(400).json({ error: 'Phone number already in use' });
      }

      const updateData = { 
        phoneNumber, 
        username, 
        firstName, 
        lastName, 
        dateOfBirth, 
        address, 
        city, 
        state, 
        zipcode,
        name: displayName,
        accountType 
      };
      await db.collection('users').doc(userRecord.uid).set(updateData, { merge: true, ignoreUndefinedProperties: true });
      logger.info('User Updated in Firestore:', userRecord.uid);

      const token = jwt.sign({ userId: userRecord.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
      return res.json({ uid: userRecord.uid, message: 'User updated', token });
    } else {
      // New user
      if (!usernameQuery.empty) {
        return res.status(400).json({ error: 'Username already in use' });
      }
      if (!phoneQuery.empty) {
        return res.status(400).json({ error: 'Phone number already in use' });
      }

      const user = await auth.createUser({ 
        email, 
        password,
        displayName,
        phoneNumber
      });
      logger.info('User Created in Auth:', user.uid);

      const userData = { 
        phoneNumber, 
        verified: false, 
        username, 
        firstName, 
        lastName, 
        dateOfBirth, 
        address, 
        city, 
        state, 
        zipcode,
        name: displayName,
        accountType 
      };
      await db.collection('users').doc(user.uid).set(userData, { ignoreUndefinedProperties: true });
      logger.info('User Written to Firestore:', user.uid);

      // const actionCodeSettings = {
      //   url: `${process.env.APP_URL}/verify-email`,
      //   handleCodeInApp: true
      // };
      // const link = await auth.generateEmailVerificationLink(email, actionCodeSettings);
      const link = await auth.generateEmailVerificationLink(email);

      await sendVerificationEmail(email, link);

      const token = jwt.sign({ userId: user.uid }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ uid: user.uid, token, message: 'User created. Verification email sent.' });
    }
  } catch (err) {
    logger.error('Error Details:', err);
    let errorMessage = 'Authentication Error';
    if (err.code === 'auth/email-already-exists') errorMessage = 'The email address is already in use by another account.';
    else if (err.code === 'auth/invalid-email') errorMessage = 'Invalid email format';
    else if (err.code === 'auth/weak-password') errorMessage = 'Password is too weak';
    else if (err.code === 'permission-denied') errorMessage = 'Firestore permission denied';
    // Add catch for undefined error
    else if (err.message.includes('undefined as a Firestore value')) errorMessage = 'Invalid query value - check required fields';
    res.status(400).json({ error: errorMessage });
  }
});

// POST /api/users/login - User login endpoint
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  try {
    // Firebase Identity Toolkit REST API for sign-in
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_API_KEY}`,
      {
        email,
        password,
        returnSecureToken: true
      }
    );
    const { idToken, localId: userId } = response.data;

    // Fetch user profile from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User not found in Firestore' });
    }
    const userData = userDoc.data();

    // Create JWT payload (use userId consistently)
    const tokenPayload = {
      userId: userId,  // Use the Firebase UID here (was localId)
      email: userData.email || email,
      role: userData.role || 'user'  // Pull from Firestore if available
    };

    // Sign the token
    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '12h' });

    // Return response
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        uid: userId,  // For compatibility if frontend expects 'uid'
        email: tokenPayload.email,
        name: userData.name || '',
        role: tokenPayload.role
      }
    });
  } catch (err) {
    const firebaseError = err.response?.data?.error?.message || err.message;
    logger.error(`Login Error for ${email}: ${firebaseError}`);
    res.status(401).json({ error: firebaseError || 'Invalid email or password' });
  }
});

// GET /api/users/profile - Protected
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    if (!userDoc.exists) {
      logger.warn(`Profile not found for user: ${req.userId}`);
      return res.status(404).json({ error: 'User profile not found' });
    }

    const userData = userDoc.data();
    // Optional: Sanitize - exclude sensitive fields if any (e.g., internal notes)
    // delete userData.someSensitiveField;

    logger.info(`Profile fetched for user: ${req.userId}`);
    res.json({ data: userData });  // Wrapped for consistency
  } catch (err) {
    logger.error('Profile Fetch Error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;

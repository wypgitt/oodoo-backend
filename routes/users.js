const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const { db, auth } = require('../config/firebase');
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// POST /api/users/register - Basic email/phone verify
router.post('/register', async (req, res) => {
  const { email, password, phone } = req.body;
  try {
    const user = await auth.createUser({ email, password });
    // Send phone OTP
    await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: 'sms' });
    await db.collection('users').doc(user.uid).set({ phone, verified: false });
    res.json({ uid: user.uid });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/users/verify-phone - Confirm OTP
router.post('/verify-phone', async (req, res) => {
  const { phone, code } = req.body;
  try {
    const check = await twilio.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });
    if (check.status === 'approved') {
      // Update user in Firestore
      const userDoc = await db.collection('users').where('phone', '==', phone).get();
      if (!userDoc.empty) userDoc.docs[0].ref.update({ verified: true });
      res.json({ success: true });
    } else res.json({ success: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/users/profile - Protected
router.get('/profile', verifyToken, async (req, res) => {
  const user = await db.collection('users').doc(req.userId).get();
  res.json(user.data());
});

module.exports = router;
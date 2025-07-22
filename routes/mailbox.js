const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const { db } = require('../config/firebase');

// POST /api/mailbox/ad - Send ad (business side)
router.post('/ad', verifyToken, async (req, res) => {
  const { content, targetUserId } = req.body;
  await db.collection('mailboxes').doc(targetUserId).collection('ads').add({ content });
  // Trigger payout on view (use Firestore listener in prod)
  res.json({ message: 'Ad sent' });
});

// GET /api/mailbox - User inbox
router.get('/', verifyToken, async (req, res) => {
  const ads = await db.collection('mailboxes').doc(req.userId).collection('ads').get();
  res.json(ads.docs.map(doc => doc.data()));
});

module.exports = router;
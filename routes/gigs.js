const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const { db } = require('../config/firebase');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// POST /api/gigs - Create gig
router.post('/', verifyToken, async (req, res) => {
  const { title, description, price } = req.body;
  try {
    const gigRef = await db.collection('gigs').add({ title, description, price, creatorId: req.userId });
    res.json({ id: gigRef.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/gigs - Search (basic)
router.get('/', async (req, res) => {
  const gigs = await db.collection('gigs').get();
  res.json(gigs.docs.map(doc => ({ id: doc.id, ...doc.data() })));
});

// POST /api/gigs/:id/bid - Bid on gig (triggers chat)
router.post('/:id/bid', verifyToken, async (req, res) => {
  // Logic to add bid, then init chat room in Firestore if needed
  res.json({ message: 'Bid placed, chat initiated' });
});

// POST /api/gigs/:id/complete - Payout with commission
router.post('/:id/complete', verifyToken, async (req, res) => {
  const { paymentMethod } = req.body;
  try {
    const payment = await stripe.paymentIntents.create({
      amount: 1500,  // Example $15
      currency: 'usd',
      payment_method: paymentMethod,
      confirm: true
    });
    // Take 10% commission, payout via Stripe Connect later
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
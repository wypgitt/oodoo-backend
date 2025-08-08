const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const Joi = require('joi');
const logger = require('../logger'); // Assume a shared logger module like Winston from users.js

/**
 * @route POST /gigs
 * @desc Create a new gig (authenticated users only)
 * @access Private
 */
router.post('/gigs', verifyToken, async (req, res) => {
  const schema = Joi.object({
    title: Joi.string().min(5).max(100).required(),
    description: Joi.string().min(10).required(),
    price: Joi.number().positive().required(),
    category: Joi.string().optional(), // e.g., "plumbing", "delivery"
    deadline: Joi.date().optional(), // ISO date string for urgency
    estimatedDuration: Joi.number().positive().optional(), // In hours
    attachments: Joi.array().items(Joi.string().uri()).optional(), // URLs to images/docs
    location: Joi.object({ // Optional exact location object
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required()
    }).optional()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }

  console.log('req.userId in route:', req.userId); // Debug: Remove in production if not needed
  if (!req.userId) {
    logger.error('User ID undefined in gig creation');
    return res.status(403).json({ error: 'Unauthorized: User ID not found' });
  }

  const gigData = {
    ...req.body,
    userId: req.userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'open',
  };

  // Handle location: Store exact and compute approximate for privacy
  if (req.body.location) {
    const { latitude, longitude } = req.body.location;
    gigData.exactLocation = new admin.firestore.GeoPoint(latitude, longitude);
    // Simple blur for approximate: Round to 1 decimal place (~11km accuracy; adjust as needed)
    const approxLat = Math.round(latitude * 10) / 10;
    const approxLong = Math.round(longitude * 10) / 10;
    gigData.approximateLocation = new admin.firestore.GeoPoint(approxLat, approxLong);
    // Remove original 'location' from gigData to avoid duplication
    delete gigData.location;
  }

  try {
    const gigRef = await db.collection('gigs').add(gigData);
    res.status(201).json({ id: gigRef.id, ...gigData });
  } catch (error) {
    logger.error('Error creating gig:', error); // Log full error
    console.error('Full error stack:', error.stack); // Temporary debug
    res.status(500).json({ error: 'Failed to create gig. Please try again.' });
  }
});

/**
 * @route GET /gigs
 * @desc Get all gigs with optional filtering, sorting, and pagination (public)
 * @access Public
 */
router.get('/gigs', async (req, res) => {
  const { limit = 10, offset = 0, status, sort } = req.query;
  let query = db.collection('gigs');

  if (status) {
    query = query.where('status', '==', status);
  }
  // Add more filters if needed, e.g., price range

  if (sort) {
    const [field, direction = 'desc'] = sort.split(':');
    query = query.orderBy(field, direction);
  }

  try {
    const snapshot = await query.limit(Number(limit)).offset(Number(offset)).get();
    const gigs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(gigs);
  } catch (error) {
    logger.error('Error fetching gigs:', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch gigs. Please try again.' });
  }
});

/**
 * @route GET /gigs/:id
 * @desc Get a gig by ID (public)
 * @access Public
 */
router.get('/gigs/:id', async (req, res) => {
  try {
    const doc = await db.collection('gigs').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Gig not found' });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (error) {
    logger.error('Error fetching gig:', { error: error.message, gigId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch gig. Please try again.' });
  }
});

/**
 * @route GET /gigs/user/:userId
 * @desc Get gigs posted by a specific user (auth required, must match self)
 * @access Private
 */
router.get('/gigs/user/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  if (req.userId !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const snapshot = await db.collection('gigs').where('userId', '==', userId).get();
    const gigs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(gigs);
  } catch (error) {
    logger.error('Error fetching user gigs:', { error: error.message, userId });
    res.status(500).json({ error: 'Failed to fetch user gigs. Please try again.' });
  }
});

/**
 * @route POST /gigs/:id/accept
 * @desc Accept a gig (auth required)
 * @access Private
 */
router.post('/gigs/:id/accept', verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    await db.runTransaction(async (transaction) => {
      const gigRef = db.collection('gigs').doc(id);
      const gigDoc = await transaction.get(gigRef);
      if (!gigDoc.exists) {
        throw new Error('Gig not found');
      }

      const gigData = gigDoc.data();
      if (gigData.userId === req.userId) {
        throw new Error('Cannot accept your own gig');
      }
      if (gigData.status !== 'open') {
        throw new Error('Gig is not open for acceptance');
      }

      // Prepare gig update
      const gigUpdate = {
        acceptedBy: req.userId,
        status: 'accepted',
        acceptedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      transaction.update(gigRef, gigUpdate);

      // Create assignment mapping in subcollection (no history array)
      const assignmentRef = gigRef.collection('assignments').doc(req.userId); // Doc ID as userId
      const assignmentData = {
        gigId: id,
        userId: req.userId,
        currentStatus: 'accepted',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      transaction.set(assignmentRef, assignmentData);

      // Add initial status history as a subcollection document
      const historyRef = assignmentRef.collection('history').doc(); // Auto-generated ID
      const historyData = {
        status: 'accepted',
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        changedBy: req.userId
      };
      transaction.set(historyRef, historyData);
    });

    res.json({ success: true, message: 'Gig accepted' });
  } catch (error) {
    logger.error('Error accepting gig:', error);  // Full error
    console.error('Full error details:', JSON.stringify(error, null, 2));
    console.error('Error stack:', error.stack);
    // Custom responses for known errors
    if (error.message === 'Gig not found') {
      return res.status(404).json({ error: error.message });
    } else if (error.message === 'Cannot accept your own gig') {
      return res.status(403).json({ error: error.message });
    } else if (error.message === 'Gig is not open for acceptance') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to accept gig. Please try again.' });
  }
});

/**
 * @route PATCH /gigs/:id/status
 * @desc Update gig status (auth required, only owner can update)
 * @access Private
 */
router.patch('/gigs/:id/status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const validStatuses = ['open', 'accepted', 'completed', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const gigRef = db.collection('gigs').doc(id);
    const gigDoc = await gigRef.get();
    if (!gigDoc.exists) {
      return res.status(404).json({ error: 'Gig not found' });
    }

    const gigData = gigDoc.data();
    if (gigData.userId !== req.userId) {
      return res.status(403).json({ error: 'Not allowed to update this gig' });
    }

    await gigRef.update({ status });
    res.json({ success: true, message: `Gig status updated to ${status}` });
  } catch (error) {
    logger.error('Error updating gig status:', { error: error.message, gigId: id, userId: req.userId });
    res.status(500).json({ error: 'Failed to update gig status. Please try again.' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const { db } = require('../config/firebase');
const admin = require('firebase-admin');
const Joi = require('joi');
const validate = require('../middleware/validate');
const logger = require('../logger');

// Schema for creating a home
const createHomeSchema = Joi.object({
  address: Joi.string().required(),
  city: Joi.string().required(),
  state: Joi.string().required(),
  zipcode: Joi.string().required(),
  location: Joi.object({
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional()
  }).optional(),
  ownerId: Joi.string().optional() // Defaults to creator
});

// Schema for attaching/detaching user
const attachDetachSchema = Joi.object({
  userId: Joi.string().required()
});

// Schema for adding data to private or public subcollections
const dataSchema = Joi.object({
  type: Joi.string().required(), // e.g., 'maintenance', 'wifi'
  data: Joi.object().required()
});

// POST /api/homes - Create a new home (protected)
router.post('/', verifyToken, validate(createHomeSchema), async (req, res) => {
  try {
    let homeData = {
      ...req.body,
      ownerId: req.body.ownerId || req.userId,
      occupants: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (req.body.location) {
      const { latitude, longitude } = req.body.location;
      homeData.location = new admin.firestore.GeoPoint(latitude, longitude);
    }

    const homeRef = await db.collection('homes').add(homeData);
    logger.info('Home created:', { id: homeRef.id, ownerId: homeData.ownerId });
    res.status(201).json({ id: homeRef.id, ...homeData });
  } catch (error) {
    logger.error('Error creating home:', error);
    res.status(500).json({ error: 'Failed to create home' });
  }
});

// GET /api/homes/:id - Get home details (protected)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const homeDoc = await db.collection('homes').doc(req.params.id).get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    const homeData = homeDoc.data();
    // Check if user is owner or occupant
    if (homeData.ownerId !== req.userId && !homeData.occupants.includes(req.userId)) {
      return res.status(403).json({ error: 'Unauthorized to view this home' });
    }
    res.json({ id: homeDoc.id, ...homeData });
  } catch (error) {
    logger.error('Error fetching home:', error);
    res.status(500).json({ error: 'Failed to fetch home' });
  }
});

// PATCH /api/homes/:id - Update home (protected, owner only)
router.patch('/:id', verifyToken, async (req, res) => {
  try {
    const homeRef = db.collection('homes').doc(req.params.id);
    const homeDoc = await homeRef.get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    if (homeDoc.data().ownerId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized to update this home' });
    }
    await homeRef.update(req.body);
    logger.info('Home updated:', { id: req.params.id });
    res.json({ success: true, message: 'Home updated' });
  } catch (error) {
    logger.error('Error updating home:', error);
    res.status(500).json({ error: 'Failed to update home' });
  }
});

// DELETE /api/homes/:id - Delete home (protected, owner only)
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const homeRef = db.collection('homes').doc(req.params.id);
    const homeDoc = await homeRef.get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    if (homeDoc.data().ownerId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized to delete this home' });
    }
    await homeRef.delete();
    logger.info('Home deleted:', { id: req.params.id });
    res.json({ success: true, message: 'Home deleted' });
  } catch (error) {
    logger.error('Error deleting home:', error);
    res.status(500).json({ error: 'Failed to delete home' });
  }
});

// POST /api/homes/:id/attach - Attach user to home (protected, owner only)
router.post('/:id/attach', verifyToken, validate(attachDetachSchema), async (req, res) => {
  try {
    const { id: homeId } = req.params;
    const { userId } = req.body;
    const homeRef = db.collection('homes').doc(homeId);
    const homeDoc = await homeRef.get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    if (homeDoc.data().ownerId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized: Only owner can attach users' });
    }
    const occupants = homeDoc.data().occupants || [];
    if (occupants.includes(userId)) {
      return res.status(400).json({ error: 'User already attached' });
    }
    await homeRef.update({
      occupants: admin.firestore.FieldValue.arrayUnion(userId)
    });
    // Update user's current home
    await db.collection('users').doc(userId).update({ currentHomeId: homeId });
    logger.info('User attached to home:', { userId, homeId });
    res.json({ success: true, message: 'User attached' });
  } catch (error) {
    logger.error('Error attaching user:', error);
    res.status(500).json({ error: 'Failed to attach user' });
  }
});

// POST /api/homes/:id/detach - Detach user from home (protected, owner only)
router.post('/:id/detach', verifyToken, validate(attachDetachSchema), async (req, res) => {
  try {
    const { id: homeId } = req.params;
    const { userId } = req.body;
    const homeRef = db.collection('homes').doc(homeId);
    const homeDoc = await homeRef.get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    if (homeDoc.data().ownerId !== req.userId) {
      return res.status(403).json({ error: 'Unauthorized: Only owner can detach users' });
    }
    const occupants = homeDoc.data().occupants || [];
    if (!occupants.includes(userId)) {
      return res.status(400).json({ error: 'User not attached' });
    }
    await homeRef.update({
      occupants: admin.firestore.FieldValue.arrayRemove(userId)
    });
    // Update user's current home
    await db.collection('users').doc(userId).update({ currentHomeId: null });
    logger.info('User detached from home:', { userId, homeId });
    res.json({ success: true, message: 'User detached' });
  } catch (error) {
    logger.error('Error detaching user:', error);
    res.status(500).json({ error: 'Failed to detach user' });
  }
});

// POST /api/homes/:id/privateData - Add private data (protected, occupants/owner only)
router.post('/:id/privateData', verifyToken, validate(dataSchema), async (req, res) => {
  try {
    const { id: homeId } = req.params;
    const { type, data } = req.body;
    const homeDoc = await db.collection('homes').doc(homeId).get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    const homeData = homeDoc.data();
    if (homeData.ownerId !== req.userId && !homeData.occupants.includes(req.userId)) {
      return res.status(403).json({ error: 'Unauthorized to add private data' });
    }
    const privateRef = await db.collection(`homes/${homeId}/privateData`).add({
      type,
      data,
      createdBy: req.userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('Private data added:', { homeId, type });
    res.status(201).json({ id: privateRef.id, type, data });
  } catch (error) {
    logger.error('Error adding private data:', error);
    res.status(500).json({ error: 'Failed to add private data' });
  }
});

// GET /api/homes/:id/privateData - Get private data (protected, occupants/owner only)
router.get('/:id/privateData', verifyToken, async (req, res) => {
  try {
    const { id: homeId } = req.params;
    const homeDoc = await db.collection('homes').doc(homeId).get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    const homeData = homeDoc.data();
    if (homeData.ownerId !== req.userId && !homeData.occupants.includes(req.userId)) {
      return res.status(403).json({ error: 'Unauthorized to view private data' });
    }
    const snapshot = await db.collection(`homes/${homeId}/privateData`).get();
    const privateData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(privateData);
  } catch (error) {
    logger.error('Error fetching private data:', error);
    res.status(500).json({ error: 'Failed to fetch private data' });
  }
});

// POST /api/homes/:id/publicData - Add public data (protected, occupants/owner only)
router.post('/:id/publicData', verifyToken, validate(dataSchema), async (req, res) => {
  try {
    const { id: homeId } = req.params;
    const { type, data } = req.body;
    const homeDoc = await db.collection('homes').doc(homeId).get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    const homeData = homeDoc.data();
    if (homeData.ownerId !== req.userId && !homeData.occupants.includes(req.userId)) {
      return res.status(403).json({ error: 'Unauthorized to add public data' });
    }
    const publicRef = await db.collection(`homes/${homeId}/publicData`).add({
      type,
      data,
      createdBy: req.userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info('Public data added:', { homeId, type });
    res.status(201).json({ id: publicRef.id, type, data });
  } catch (error) {
    logger.error('Error adding public data:', error);
    res.status(500).json({ error: 'Failed to add public data' });
  }
});

// GET /api/homes/:id/publicData - Get public data (protected for now; can make public by removing verifyToken)
router.get('/:id/publicData', verifyToken, async (req, res) => {
  try {
    const { id: homeId } = req.params;
    const homeDoc = await db.collection('homes').doc(homeId).get();
    if (!homeDoc.exists) {
      return res.status(404).json({ error: 'Home not found' });
    }
    // For truly public, remove the auth check below and verifyToken
    const homeData = homeDoc.data();
    if (homeData.ownerId !== req.userId && !homeData.occupants.includes(req.userId)) {
      return res.status(403).json({ error: 'Unauthorized to view public data' });
    }
    const snapshot = await db.collection(`homes/${homeId}/publicData`).get();
    const publicData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(publicData);
  } catch (error) {
    logger.error('Error fetching public data:', error);
    res.status(500).json({ error: 'Failed to fetch public data' });
  }
});

module.exports = router;

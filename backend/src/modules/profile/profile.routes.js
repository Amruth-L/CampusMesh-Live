const express = require('express');
const router = express.Router();
const profileController = require('./profile.controller');
const authMiddleware = require('../../middleware/authMiddleware');

// GET /api/profile - Get current user profile
router.get('/', authMiddleware, profileController.getProfile);

// PUT /api/profile - Update user profile
router.put('/', authMiddleware, profileController.updateProfile);

module.exports = router;


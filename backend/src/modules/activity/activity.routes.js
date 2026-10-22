const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const controller = require('./activity.controller');

const router = express.Router();
router.use(authMiddleware);
router.get('/history', controller.getHistory);
module.exports = router;

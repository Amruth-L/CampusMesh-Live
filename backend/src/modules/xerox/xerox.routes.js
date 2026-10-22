const express = require('express');
const router = express.Router();
const auth = require('../../middleware/authMiddleware');
const controller = require('./xerox.controller');
const pdfBody = express.raw({ type: 'application/pdf', limit: '15mb' });
router.use(auth);
router.post('/preview', pdfBody, controller.preview);
router.post('/requests', pdfBody, controller.createRequest);
router.get('/requests/mine', controller.mine);
router.get('/desk/requests', controller.deskQueue);
router.post('/:id/print', controller.markPrinting);
router.post('/:id/ready', controller.markReady);
router.get('/:id/document', controller.document);
module.exports = router;


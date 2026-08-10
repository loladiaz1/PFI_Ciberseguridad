const express = require('express');
const { listActivity } = require('../controllers/activityController');

const router = express.Router();

router.get('/', listActivity);

module.exports = router;

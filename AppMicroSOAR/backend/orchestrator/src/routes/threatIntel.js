const express = require('express');
const {
  listThreatIntel,
  getThreatIntelById,
} = require('../controllers/threatIntelController');

const router = express.Router();

router.get('/', listThreatIntel);
router.get('/:id', getThreatIntelById);

module.exports = router;

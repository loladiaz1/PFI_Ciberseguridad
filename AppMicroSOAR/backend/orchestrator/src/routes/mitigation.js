const express = require('express');
const {
  listMitigations,
  getMitigationById,
} = require('../controllers/mitigationController');

const router = express.Router();

router.get('/', listMitigations);
router.get('/:id', getMitigationById);

module.exports = router;

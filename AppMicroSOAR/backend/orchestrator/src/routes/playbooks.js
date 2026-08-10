const express = require('express');
const { listPlaybooks, getPlaybookById } = require('../controllers/playbookController');

const router = express.Router();

router.get('/', listPlaybooks);
router.get('/:id', getPlaybookById);

module.exports = router;

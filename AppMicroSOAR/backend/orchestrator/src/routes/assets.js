const express = require('express');
const { listAssets, getAssetById } = require('../controllers/assetController');

const router = express.Router();

router.get('/', listAssets);
router.get('/:id', getAssetById);

module.exports = router;

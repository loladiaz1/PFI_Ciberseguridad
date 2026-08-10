const express = require('express');
const {
  listIncidents,
  getIncidentById,
  resolveIncident,
} = require('../controllers/incidentController');

const router = express.Router();

router.get('/', listIncidents);
router.get('/:id', getIncidentById);
router.post('/:id/resolve', resolveIncident);

module.exports = router;

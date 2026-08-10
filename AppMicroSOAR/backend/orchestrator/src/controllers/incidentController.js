const {
  getAllIncidents,
  getIncident,
  resolveIncidentById,
} = require('../services/incidentService');

exports.listIncidents = async (_req, res, next) => {
  try {
    const incidents = await getAllIncidents();
    res.json(incidents);
  } catch (error) {
    next(error);
  }
};

exports.getIncidentById = async (req, res, next) => {
  try {
    const incident = await getIncident(req.params.id);
    if (!incident) {
      return res.status(404).json({ message: 'Incident not found' });
    }
    res.json(incident);
  } catch (error) {
    next(error);
  }
};

exports.resolveIncident = async (req, res, next) => {
  try {
    const incident = await resolveIncidentById(req.params.id);
    res.json(incident);
  } catch (error) {
    next(error);
  }
};

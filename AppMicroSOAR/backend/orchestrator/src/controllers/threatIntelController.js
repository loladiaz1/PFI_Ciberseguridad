exports.listThreatIntel = async (_req, res) => {
  res.json([]);
};

exports.getThreatIntelById = async (req, res) => {
  res.status(404).json({ message: 'Threat intel not found' });
};

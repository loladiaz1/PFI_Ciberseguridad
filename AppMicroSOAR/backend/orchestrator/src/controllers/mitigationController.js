exports.listMitigations = async (_req, res) => {
  res.json([]);
};

exports.getMitigationById = async (req, res) => {
  res.status(404).json({ message: 'Mitigation not found' });
};

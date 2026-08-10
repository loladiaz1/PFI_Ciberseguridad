exports.listPlaybooks = async (_req, res) => {
  res.json([]);
};

exports.getPlaybookById = async (req, res) => {
  res.status(404).json({ message: 'Playbook not found' });
};

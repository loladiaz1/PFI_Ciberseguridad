exports.listAssets = async (_req, res) => {
  res.json([]);
};

exports.getAssetById = async (req, res) => {
  res.status(404).json({ message: 'Asset not found' });
};

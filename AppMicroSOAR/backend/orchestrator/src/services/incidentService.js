const { prisma } = require('../db');

exports.getAllIncidents = async () => {
  return prisma.incident.findMany({ orderBy: { id: 'desc' } });
};

exports.getIncident = async (id) => {
  return prisma.incident.findUnique({ where: { id: Number(id) } });
};

exports.resolveIncidentById = async (id) => {
  return prisma.incident.update({
    where: { id: Number(id) },
    data: { status: 'resolved' },
  });
};

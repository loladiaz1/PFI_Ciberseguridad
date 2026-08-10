let users = [
  {
    id: "1",
    name: "Admin",
    email: "admin@fortia.com",
    role: "ADMIN",
    avatarUrl: null,
  },
];

const getUsers = (req, res) => {
  res.json(users);
};

const getUserById = (req, res) => {
  const user = users.find((user) => user.id === req.params.id);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  res.json(user);
};

const createUser = (req, res) => {
  const { name, email, role, avatarUrl } = req.body;

  if (!name || !email || !role) {
    return res.status(400).json({
      message: "name, email and role are required",
    });
  }

  const newUser = {
    id: String(users.length + 1),
    name,
    email,
    role,
    avatarUrl: avatarUrl ?? null,
  };

  users.push(newUser);

  res.status(201).json(newUser);
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
};
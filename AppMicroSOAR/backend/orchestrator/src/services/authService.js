exports.loginUser = async ({ email, password }) => {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  return {
    user: { email },
    token: 'demo-token',
  };
};

exports.registerUser = async ({ name, email, password }) => {
  if (!name || !email || !password) {
    throw new Error('Please complete all fields');
  }

  return {
    user: { name, email },
    token: 'demo-token',
  };
};

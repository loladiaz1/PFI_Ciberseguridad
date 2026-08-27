const express = require("express");

const {
  getUsers,
  getUserById,
  createUser,
  updateUser,
} = require("../controllers/userController");

const router = express.Router();

router.get("/", getUsers);

router.get("/:id", getUserById);

router.post("/", createUser);

router.put("/:id", updateUser);

module.exports = router;
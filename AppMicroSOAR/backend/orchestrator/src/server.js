const app = require("./app");

const PORT = 3000;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Micro-SOAR backend running on http://localhost:${PORT}`);
});
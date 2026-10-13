// Cliente de la API de Wazuh (src/wazuh.js) con axios mockeado: el resto de
// los tests mockea wazuh.js entero, asi que aca se prueba el contrato real
// con la API -- en particular los rechazos "silenciosos" (HTTP 200 con la
// accion fallida en el body), que son los que hubieran hecho mentir a la app.
jest.mock("axios");

const axios = require("axios");
const { authenticate, blockIp, isolateHost } = require("../src/wazuh");

const HOST = "https://wazuh.invalid:55000";
const OK = { status: 200, data: { error: 0, data: { total_failed_items: 0 } } };

afterEach(() => {
  axios.get.mockReset();
  axios.put.mockReset();
});

describe("authenticate", () => {
  test("devuelve el token JWT del manager", async () => {
    axios.get.mockResolvedValue({ status: 200, data: { data: { token: "jwt-123" } } });

    await expect(authenticate(HOST, "wazuh-wui", "secret")).resolves.toBe("jwt-123");
    expect(axios.get).toHaveBeenCalledWith(
      `${HOST}/security/user/authenticate`,
      expect.objectContaining({ auth: { username: "wazuh-wui", password: "secret" } })
    );
  });

  test("credenciales rechazadas -> error con el status", async () => {
    axios.get.mockResolvedValue({ status: 401, data: { title: "Unauthorized" } });

    await expect(authenticate(HOST, "x", "y")).rejects.toThrow("Login rechazado (401)");
  });
});

describe.each([
  ["blockIp", (token) => blockIp(HOST, token, "001", "203.0.113.9")],
  ["isolateHost", (token) => isolateHost(HOST, token, "001")],
])("%s", (name, run) => {
  test("HTTP 200 sin items fallidos -> ok", async () => {
    axios.put.mockResolvedValue(OK);

    await expect(run("tok")).resolves.toEqual(OK.data);
    expect(axios.put).toHaveBeenCalledWith(
      `${HOST}/active-response`,
      expect.any(Object),
      expect.objectContaining({
        headers: { Authorization: "Bearer tok" },
        params: { agents_list: "001" },
      })
    );
  });

  test("status HTTP de error -> rechaza", async () => {
    axios.put.mockResolvedValue({ status: 400, data: { title: "Bad Request" } });

    await expect(run("tok")).rejects.toThrow("El comando fue rechazado (400)");
  });

  test("HTTP 200 pero error en el body -> rechaza", async () => {
    axios.put.mockResolvedValue({ status: 200, data: { error: 1, data: { total_failed_items: 0 } } });

    await expect(run("tok")).rejects.toThrow("El comando fue rechazado");
  });

  test("HTTP 200 pero el agente fallo (ej. 1703 en el agente 000) -> rechaza", async () => {
    axios.put.mockResolvedValue({
      status: 200,
      data: { error: 0, data: { total_failed_items: 1, failed_items: [{ error: { code: 1703 } }] } },
    });

    await expect(run("tok")).rejects.toThrow("El comando fue rechazado");
  });
});

test("ninguna llamada deja que axios tire por status HTTP: el status se evalua a mano", async () => {
  // Si axios tirara en 4xx/5xx, el mensaje de error perderia el body de
  // Wazuh (que dice POR QUE rechazo la accion).
  axios.get.mockResolvedValue({ status: 200, data: { data: { token: "t" } } });
  axios.put.mockResolvedValue(OK);

  await authenticate(HOST, "u", "p");
  await blockIp(HOST, "t", "001", "203.0.113.9");
  await isolateHost(HOST, "t", "001");

  const configs = [axios.get.mock.calls[0][1], axios.put.mock.calls[0][2], axios.put.mock.calls[1][2]];
  for (const config of configs) {
    expect(config.validateStatus(500)).toBe(true);
    expect(config.httpsAgent.options.rejectUnauthorized).toBe(false); // cert autofirmado del lab
  }
});

test("blockIp manda la IP en alert.data.srcip (lo que lee firewall-drop)", async () => {
  axios.put.mockResolvedValue(OK);

  await blockIp(HOST, "tok", "001", "203.0.113.9");

  expect(axios.put.mock.calls[0][1]).toEqual({
    command: "!firewall-drop",
    alert: { data: { srcip: "203.0.113.9" } },
  });
});

test("isolateHost manda !isolate-host sin IP (aisla al propio agente)", async () => {
  axios.put.mockResolvedValue(OK);

  await isolateHost(HOST, "tok", "001");

  expect(axios.put.mock.calls[0][1]).toEqual({ command: "!isolate-host" });
});

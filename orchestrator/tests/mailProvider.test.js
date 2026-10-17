// Integracion IMAP (CU-03) contra un ImapFlow falso: un "servidor" en memoria
// con buzones -> carpetas -> mensajes.
jest.mock("imapflow");

const { ImapFlow } = require("imapflow");
const mailProvider = require("../src/mailProvider");

const ORIGINAL_ENV = { ...process.env };
let server;

// Cliente falso: entra al buzon del usuario antes del "*" (login master).
function fakeClient(options) {
  const [mailbox, master] = options.auth.user.split("*");
  const client = {
    logins: { mailbox, master, pass: options.auth.pass },
    mailbox: null,
    folder: null,
    connect: jest.fn(async () => {}),
    logout: jest.fn(async () => {}),
    getMailboxLock: jest.fn(async (folder) => {
      client.folder = folder;
      client.mailbox = { exists: (server[mailbox]?.[folder] ?? []).length };
      return { release: jest.fn() };
    }),
    fetchAll: jest.fn(async () => server[mailbox][client.folder].map((m) => ({ uid: m.uid, source: m.source, internalDate: m.date }))),
    search: jest.fn(async (query) => {
      const id = query.header["message-id"];
      return (server[mailbox]?.[client.folder] ?? []).filter((m) => m.messageId === id).map((m) => m.uid);
    }),
    messageMove: jest.fn(async (uids, to) => {
      const list = [].concat(uids).map(Number);
      const from = server[mailbox][client.folder];
      const moving = from.filter((m) => list.includes(m.uid));
      server[mailbox][client.folder] = from.filter((m) => !list.includes(m.uid));
      server[mailbox][to] = [...(server[mailbox][to] ?? []), ...moving];
      return true;
    }),
  };
  return client;
}

beforeEach(() => {
  process.env.MAIL_IMAP_HOST = "10.0.0.9";
  process.env.MAIL_MASTER_PASSWORD = "master-secret";
  process.env.MAIL_REPORT_MAILBOX = "phishing@lab";
  process.env.MAIL_MAILBOXES = "alice@lab, bob@lab,carol@lab";
  server = {
    "phishing@lab": { INBOX: [] },
    "alice@lab": { INBOX: [{ uid: 1, messageId: "<m1>" }, { uid: 2, messageId: "<otro>" }] },
    "bob@lab": { INBOX: [{ uid: 7, messageId: "<m1>" }] },
    "carol@lab": { INBOX: [] },
  };
  ImapFlow.mockImplementation((options) => fakeClient(options));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.clearAllMocks();
});

test("habilitada solo con host, clave del master y buzon de reportes", () => {
  expect(mailProvider.isEnabled()).toBe(true);
  delete process.env.MAIL_MASTER_PASSWORD;
  expect(mailProvider.isEnabled()).toBe(false);
});

test("entra a cada buzon con el usuario master por IMAPS", async () => {
  await mailProvider.quarantine("<m1>");
  const options = ImapFlow.mock.calls[0][0];
  expect(options).toMatchObject({ host: "10.0.0.9", port: 993, secure: true, auth: { user: "alice@lab*soar", pass: "master-secret" } });
});

test("cuarentena: mueve el correo a Quarantine en los buzones donde esta", async () => {
  const found = await mailProvider.quarantine("<m1>");
  expect(found).toEqual(["alice@lab", "bob@lab"]);
  expect(server["alice@lab"].INBOX.map((m) => m.messageId)).toEqual(["<otro>"]);
  expect(server["alice@lab"].Quarantine.map((m) => m.uid)).toEqual([1]);
  expect(server["bob@lab"].Quarantine).toHaveLength(1);
});

test("restaurar: lo devuelve a la bandeja de entrada", async () => {
  await mailProvider.quarantine("<m1>");
  const found = await mailProvider.restore("<m1>");
  expect(found).toEqual(["alice@lab", "bob@lab"]);
  expect(server["bob@lab"].INBOX.map((m) => m.uid)).toEqual([7]);
  expect(server["bob@lab"].Quarantine).toEqual([]);
});

test("reportes: los procesa y los archiva en Processed, o en Invalid si fallan", async () => {
  server["phishing@lab"].INBOX = [
    { uid: 1, source: Buffer.from("bueno"), date: new Date() },
    { uid: 2, source: Buffer.from("malo"), date: new Date() },
  ];
  jest.spyOn(console, "error").mockImplementation(() => {});
  const handle = jest.fn(async (raw) => {
    if (raw.toString() === "malo") throw new Error("sin adjunto");
  });

  expect(await mailProvider.fetchReports(handle)).toBe(1);
  expect(handle).toHaveBeenCalledTimes(2);
  expect(server["phishing@lab"].Processed.map((m) => m.uid)).toEqual([1]);
  expect(server["phishing@lab"].Invalid.map((m) => m.uid)).toEqual([2]);
  expect(server["phishing@lab"].INBOX).toEqual([]);
});

test("buzon de reportes vacio: no pide mensajes", async () => {
  const handle = jest.fn();
  expect(await mailProvider.fetchReports(handle)).toBe(0);
  expect(handle).not.toHaveBeenCalled();
});

test("cierra la sesion aunque la operacion falle", async () => {
  let client;
  ImapFlow.mockImplementation((options) => {
    client = fakeClient(options);
    client.search.mockRejectedValue(new Error("IMAP caido"));
    client.logout.mockRejectedValue(new Error("ya desconectado"));
    return client;
  });
  await expect(mailProvider.quarantine("<m1>")).rejects.toThrow("IMAP caido");
  expect(client.logout).toHaveBeenCalled();
});

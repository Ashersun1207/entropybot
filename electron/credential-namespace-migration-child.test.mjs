import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  app: { setName: vi.fn(), setPath: vi.fn(), whenReady: vi.fn(), exit: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  safeStorage: { isAsyncEncryptionAvailable: vi.fn(), decryptStringAsync: vi.fn() },
  existsSync: vi.fn(), readFileSync: vi.fn(), writeSync: vi.fn(),
}));
vi.mock("electron", () => ({ app: mock.app, dialog: mock.dialog, safeStorage: mock.safeStorage }));
vi.mock("node:fs", () => ({ default: mock }));
import { installLegacyCredentialRead } from "./credential-namespace-migration-child.mjs";
import { LEGACY_READ_FLAG, parseLegacyCredentialResult } from "./credential-namespace-migration.mjs";

const credentials = { memoryEmbeddingKey: "synthetic-consent-canary" };
const ready = () => vi.waitFor(() => expect(mock.app.exit).toHaveBeenCalled());
beforeEach(() => {
  vi.resetAllMocks();
  mock.app.whenReady.mockResolvedValue();
  mock.dialog.showMessageBox.mockResolvedValue({ response: 0 });
  mock.existsSync.mockReturnValue(true);
  mock.readFileSync.mockReturnValue(Buffer.from("synthetic ciphertext"));
  mock.safeStorage.isAsyncEncryptionAvailable.mockResolvedValue(true);
  mock.safeStorage.decryptStringAsync.mockResolvedValue({ result: JSON.stringify(credentials) });
});
const install = () => installLegacyCredentialRead({
  argv: ["fixture-electron", LEGACY_READ_FLAG],
  env: { ENTROPYBOT_LEGACY_CREDENTIALS_FILE: "/synthetic/credentials.bin", ENTROPYBOT_LEGACY_PROFILE: "/synthetic/profile" },
});

describe("legacy CLI export authorization", () => {
  it("does nothing without the internal flag", () => {
    expect(installLegacyCredentialRead({ argv: [], env: {} })).toBe(false);
    expect(mock.app.whenReady).not.toHaveBeenCalled();
  });
  it("defaults to cancellation before any credential file access or decryption", async () => {
    expect(install()).toBe(true);
    await ready();
    expect(mock.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ defaultId: 0, cancelId: 0 }));
    expect(mock.existsSync).not.toHaveBeenCalled();
    expect(mock.readFileSync).not.toHaveBeenCalled();
    expect(mock.safeStorage.decryptStringAsync).not.toHaveBeenCalled();
    expect(mock.writeSync.mock.calls.every(([fd]) => fd === 2)).toBe(true);
    expect(mock.app.exit).toHaveBeenCalledWith(1);
  });
  it("fails closed if the native authorization dialog fails", async () => {
    mock.dialog.showMessageBox.mockRejectedValue(new Error("dialog unavailable"));
    install();
    await ready();
    expect(mock.readFileSync).not.toHaveBeenCalled();
    expect(mock.app.exit).toHaveBeenCalledWith(1);
  });
  it("exports only after explicit user authorization and sets the old name before ready", async () => {
    mock.dialog.showMessageBox.mockResolvedValue({ response: 1 });
    install();
    expect(mock.app.setName).toHaveBeenCalledWith("openmausbot");
    expect(mock.app.setName.mock.invocationCallOrder[0]).toBeLessThan(mock.app.whenReady.mock.invocationCallOrder[0]);
    await ready();
    const output = mock.writeSync.mock.calls.find(([fd]) => fd === 1)[1];
    expect(parseLegacyCredentialResult(output)).toEqual(credentials);
    expect(mock.dialog.showMessageBox.mock.invocationCallOrder[0]).toBeLessThan(mock.readFileSync.mock.invocationCallOrder[0]);
    expect(mock.app.exit).toHaveBeenCalledWith(0);
  });
});

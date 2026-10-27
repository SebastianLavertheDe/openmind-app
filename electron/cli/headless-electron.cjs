function desktopOnly() { throw new Error('This operation requires the OpenMind desktop application.'); }
module.exports = { app: undefined, BrowserWindow: desktopOnly, nativeImage: new Proxy({}, { get: () => desktopOnly }), shell: new Proxy({}, { get: () => desktopOnly }) };

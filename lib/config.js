var fs = require('fs');
var path = require('path');
var APP_ROOT = require('./approot.js');

class Config {
  constructor() {
    this.defaultConfig = {
      // uncommon high ports chosen to minimise clashes with other apps:
      // 8000-8100 (dev servers), 8080 (proxies), 3000/5000/9000 (frameworks)
      // are all frequent collision sources; 49152+ is the Windows ephemeral
      // range and must be avoided too
      port: 18420,
      websocket_port: 18421,
      public: true,
      secret: "top_secret",
      mcp_port: 18422,
      mcp_token: "", // generated on first start if empty (see mcp.js)
      tray: true, // system tray icon with open homepage / copy MCP / close
      open_browser: true, // packaged exe opens the web UI in the default browser
      // seconds between automatic re-find scans for network printers whose
      // DHCP address changed (serial-based rebind); minimum 30
      discovery_interval: 120
    };

    this.currentConfig = {};

    // read config.json from the application root at runtime (not via require,
    // so a packaged exe picks up the file next to the binary and the generated
    // mcp_token survives restarts)
    var local_config = {};
    try {
      local_config = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'config.json'), 'utf8'));
    } catch (e) { /* no config file yet: defaults apply */ }

    this.currentConfig = Object.assign(this.currentConfig, this.defaultConfig, local_config);
  }

  getConfig() {
    return this.currentConfig;
  }

  // update a value and persist config.json (used for ui_lang, the tray menu
  // language that follows the web UI selector); never let a write failure
  // break the caller
  set(key, value) {
    this.currentConfig[key] = value;
    try {
      fs.writeFileSync(path.join(APP_ROOT, 'config.json'),
        JSON.stringify(this.currentConfig, null, 2), 'utf8');
    } catch (e) { /* read-only volume etc: keep the in-memory value only */ }
  }
}

module.exports = new Config();

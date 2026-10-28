// Printer model profiles: model -> recommended print settings.
// Extend this registry to support more models. Matched by regex against
// the reported device.product_name (e.g. "ZT510", "Zebra Technologies ZT510").

var profiles = [
  {
    match: /ZT510/i,
    name: 'ZT510',
    media: 'thermal_transfer',
    zpl_header: '^MTT\n^PR2',
    note: 'thermal transfer (ribbon) is the site default since 2026-10-26; direct thermal is opt-in per printer'
  },
  {
    match: /ZT41[01]|ZT42[01]/i,
    name: 'ZT4xx',
    media: 'thermal_transfer',
    zpl_header: '',
    note: 'ZT400 series, thermal transfer default'
  },
  {
    match: /ZD42[01]|ZD62[01]/i,
    name: 'ZD4xx/ZD6xx',
    media: 'direct_thermal',
    zpl_header: '^MTD',
    note: 'ZD desktop series, direct thermal common'
  },
  {
    match: /GK888|GK420|GX420|GX430/i,
    name: 'G-series',
    media: 'direct_thermal',
    zpl_header: '^MTD',
    note: 'G-series desktop, direct thermal common'
  }
];

// fallback when no profile matches
var defaultProfile = {
  match: null,
  name: 'Generic Zebra',
  media: 'unknown',
  zpl_header: '',
  note: ''
};

function getProfile(model) {
  if (!model) return defaultProfile;
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].match.test(model)) return profiles[i];
  }
  return defaultProfile;
}

// convert printhead dpi to the nearest standard dpmm value
function dpmmFromDpi(dpi) {
  if (!dpi) return null;
  if (dpi <= 168) return '6dpmm';
  if (dpi <= 260) return '8dpmm';
  if (dpi <= 450) return '12dpmm';
  return '24dpmm';
}

// a reply counts as Zebra when it names Zebra or matches a known model pattern
function isZebraModel(model) {
  if (!model) return false;
  if (/zebra/i.test(model)) return true;
  for (var i = 0; i < profiles.length; i++) {
    if (profiles[i].match.test(model)) return true;
  }
  return false;
}

// printer-level default print settings, resolved from model + printhead dpi.
// CALIBRATION NOTES (verified on site 2026-10-25):
// - ^MD is an OFFSET from the printer's panel base darkness (SGD
//   "media.darkness"), NOT an absolute value. Panel bases differ between
//   units of the same model (.19 = 15.0, .42 = 22.0), so the optimal MD
//   differs per unit and must be calibrated per printer.
// - Defaults below are heuristic starting points only: thermal transfer
//   with darkness 0 (= panel base), 2 ips. Adjust per printer via its own
//   settings when output is blurry (too dark) or faint (too light).
function getSettings(model, dpi) {
  var profile = getProfile(model);
  var settings = {
    // thermal transfer is the site default; only known direct-thermal
    // desktop families opt in via their profile
    mode: profile.media === 'direct_thermal' ? 'direct_thermal' : 'thermal_transfer',
    darkness: 0,
    speed: 2
  };
  if (/ZT510/i.test(model || '')) {
    settings.darkness = 0;
  }
  return settings;
}

module.exports = {
  profiles: profiles,
  getProfile: getProfile,
  getSettings: getSettings,
  dpmmFromDpi: dpmmFromDpi,
  isZebraModel: isZebraModel
};

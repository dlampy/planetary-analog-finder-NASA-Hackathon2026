// ==========================================
// RECOMMENDED EARTH & MOON SITES FOR WELCOME SCREEN
// Coordinates synced with merged_earth_features_clean.csv & planetary_bases.csv
// ==========================================

export const WELCOME_EARTH_SITES = [
  {
    id: 'atacama_valle_de_la_luna',
    planet: 'earth',
    name: 'Atacama · Valle de la Luna',
    region: 'Chile',
    lat: -22.9167,
    lon: -68.2833,
    highlight: 'Hyper-Arid · High Thermal Swing',
    desc: 'Hyper-arid desert (~29 mm/yr rainfall) with silicate terrain and wide diurnal temperature swings matching dusty rocky worlds.'
  },
  {
    id: 'kilauea',
    planet: 'earth',
    name: 'Kīlauea Volcano',
    region: 'Hawaii, USA',
    lat: 19.4069,
    lon: -155.2834,
    highlight: '100% Basaltic Terrain',
    desc: 'Mineral-rich basaltic lava fields ideal for simulating lunar Maria plains and testing regolith ISRU extraction.'
  },
  {
    id: 'jeju_manjanggul_lava_tube',
    planet: 'earth',
    name: 'Manjanggul Lava Tube',
    region: 'Jeju, South Korea',
    lat: 33.5284,
    lon: 126.7715,
    highlight: 'Lava Tube · 100% Basalt',
    desc: 'Intact natural basaltic lava tube system suited for testing subterranean habitat deployment and radiation shielding.'
  },
  {
    id: 'batagaika_crater',
    planet: 'earth',
    name: 'Batagaika Crater',
    region: 'Siberia, Russia',
    lat: 67.5803,
    lon: 134.7711,
    highlight: 'Polar Cold (-13.8 °C) · Permafrost',
    desc: 'Thermokarst permafrost megaslump with high ground-ice content, analogous to cold lunar polar crater environments.'
  }
];

export const WELCOME_MOON_SITES = [
  {
    id: 'moon_shackleton_rim',
    planet: 'moon',
    name: 'Shackleton Crater Rim',
    region: 'Lunar South Pole',
    lat: -89.54,
    lon: 0.0,
    highlight: 'Artemis Target · Water Ice',
    desc: 'Near-continuously illuminated crater rim bordering a Permanently Shadowed Region (PSR) with potential water ice.'
  },
  {
    id: 'moon_marius_hills_pit',
    planet: 'moon',
    name: 'Marius Hills Skylight Pit',
    region: 'Oceanus Procellarum',
    lat: 14.09,
    lon: -56.77,
    highlight: 'Lava Tube Skylight',
    desc: 'Subsurface lava tube skylight offering stable thermal conditions and protection from cosmic radiation and micrometeorites.'
  },
  {
    id: 'moon_tranquillitatis_pit',
    planet: 'moon',
    name: 'Mare Tranquillitatis Pit',
    region: 'Sea of Tranquility',
    lat: 8.33,
    lon: 33.22,
    highlight: 'Basalt Mare & Subsurface Void',
    desc: 'Deep collapse pit in an ancient titanium-rich basaltic plain (near Apollo 11), favorable for rover traversal.'
  },
  {
    id: 'moon_aristarchus',
    planet: 'moon',
    name: 'Aristarchus Plateau',
    region: 'Volcanic Plateau',
    lat: 23.7,
    lon: -47.4,
    highlight: 'ISRU Resources · Pyroxene',
    desc: 'Geologically diverse volcanic plateau rich in pyroclastic glass and minerals for in-situ oxygen and propellant production.'
  }
];

export const WELCOME_QUICK_PAIRS = [
  {
    id: 'pair-basalt-mare',
    label: '🌋 Kīlauea ↔ Mare Tranquillitatis Pit',
    sub: 'Volcanic basalt terrain & ISRU comparison',
    earthLat: 19.4069,
    earthLon: -155.2834,
    targetPlanet: 'moon',
    targetLat: 8.33,
    targetLon: 33.22
  },
  {
    id: 'pair-ice-polar',
    label: '❄️ Batagaika Crater ↔ Shackleton Crater Rim',
    sub: 'Polar cold & permafrost ice comparison',
    earthLat: 67.5803,
    earthLon: 134.7711,
    targetPlanet: 'moon',
    targetLat: -89.54,
    targetLon: 0.0
  },
  {
    id: 'pair-lavatube',
    label: '🕳️ Manjanggul (Jeju) ↔ Marius Hills Pit',
    sub: 'Subsurface lava-tube habitat comparison',
    earthLat: 33.5284,
    earthLon: 126.7715,
    targetPlanet: 'moon',
    targetLat: 14.09,
    targetLon: -56.77
  }
];

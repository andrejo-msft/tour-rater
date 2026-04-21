// Tour Rater rubric data.
// Bump RUBRIC_VERSION whenever criteria or weights change so old rating
// files remain interpretable.
window.RUBRIC_VERSION = '2026-04-20-v1';
window.APP_VERSION = '1.0.0';

window.RUBRIC = [
  {
    id: 'location-civic',
    name: 'Location & Civic',
    criteria: [
      { id: 'convenient-to-friends', name: 'Location convenient to friends', weight: 2.5 },
      { id: 'active-transport',      name: 'Active transport potential',     weight: 3   },
      { id: 'leisure-walking',       name: 'Leisure walking potential',      weight: 2.5 },
      { id: 'lower-property-taxes',  name: 'Lower property taxes',           weight: 3   }
    ]
  },
  {
    id: 'outdoor-site',
    name: 'Outdoor & Site',
    criteria: [
      { id: 'garage-workspace',     name: 'Garage with workspace',                            weight: 3   },
      { id: 'sheltered-outdoor',    name: 'Sheltered outdoor spaces with sufficient privacy', weight: 2   },
      { id: 'mature-tree',          name: 'At least one mature healthy tree',                 weight: 1.5 },
      { id: 'native-plant-potential', name: 'Native plant potential',                         weight: 3   }
    ]
  },
  {
    id: 'interior-character',
    name: 'Interior Character',
    criteria: [
      { id: 'hardwood-floors',  name: 'Hardwood floors > carpet', weight: 2   },
      { id: 'natural-woodwork', name: 'Natural woodwork',         weight: 3   },
      { id: 'safe-stairs',      name: 'Safe stairs',              weight: 1.5 },
      { id: 'sunny-morning',    name: 'Sunny morning space',      weight: 3   }
    ]
  },
  {
    id: 'size-program',
    name: 'Size & Program',
    criteria: [
      { id: 'square-footage',    name: '1700-2000 square feet',          weight: 3   },
      { id: 'sedentary-hobbies', name: 'Space for sedentary hobbies',    weight: 2.5 },
      { id: 'active-hobbies',    name: 'Space for active hobbies',       weight: 2   },
      { id: 'pet-care',          name: 'Spaces for pet care and litter', weight: 1.5 }
    ]
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    criteria: [
      { id: 'cooking-station',  name: 'Cooking station',  weight: 3   },
      { id: 'baking-station',   name: 'Baking station',   weight: 1.5 },
      { id: 'cleanup-station',  name: 'Cleanup station',  weight: 3   },
      { id: 'beverage-station', name: 'Beverage station', weight: 2   }
    ]
  },
  {
    id: 'systems-bath',
    name: 'Systems & Bath',
    criteria: [
      { id: 'two-bathrooms',         name: 'Two bathrooms, well placed',      weight: 3   },
      { id: 'frictionless-bath',     name: 'Frictionless bathroom amenities', weight: 2   },
      { id: 'johnson-ready-panel',   name: 'Johnson-ready electrical panel',  weight: 1.5 },
      { id: 'central-air-heat-pump', name: 'Central air or heat pumps',       weight: 1   }
    ]
  }
];

// Score scale: 0=absent/N/A, 1=poor, 2=adequate, 3=excellent.
window.SCORE_SCALE = [
  { value: 0, label: '0', help: 'absent / N/A' },
  { value: 1, label: '1', help: 'poor' },
  { value: 2, label: '2', help: 'adequate' },
  { value: 3, label: '3', help: 'excellent' }
];

// Thresholds (per Cleo's analysis).
window.THRESHOLDS = {
  purchaseRawMin: 57,   // out of 72
  tourRawMin: 20,       // out of 36, remote-scoreable subset
  rawMax: 72,
  weightedMax: 168
};

// Helper: flat list of all criteria with category metadata.
window.allCriteria = function () {
  var out = [];
  window.RUBRIC.forEach(function (cat) {
    cat.criteria.forEach(function (c) {
      out.push({ categoryId: cat.id, categoryName: cat.name, id: c.id, name: c.name, weight: c.weight });
    });
  });
  return out;
};

// Module export shim so test.js (Node) can require this same file.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RUBRIC_VERSION: window.RUBRIC_VERSION,
    APP_VERSION: window.APP_VERSION,
    RUBRIC: window.RUBRIC,
    SCORE_SCALE: window.SCORE_SCALE,
    THRESHOLDS: window.THRESHOLDS,
    allCriteria: window.allCriteria
  };
}

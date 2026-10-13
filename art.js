/**
 * Expelled — sigils: small line drawings for regions, nemeses and factions (v2.5).
 * Each is an inline SVG on a 64×64 grid, drawn in currentColor so CSS picks the colour.
 * Loaded in the browser as window.ExpelledArt, and in Node via require() for tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ExpelledArt = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function svg(body) {
    return (
      '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ' +
      'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      body +
      "</svg>"
    );
  }

  // Region ids are kept from the Arthurian era (see content.js): camelot = Hollowmere, avalon = the Witchwood,
  // wastes = the Ashen Wastes, lyonesse = the Drowned Archive, spire = the Black Spire.
  const REGION_SIGILS = {
    // Crooked spires over a canal, under a thin moon
    camelot: svg(
      '<path d="M12 46V28l4-12 4 12v18"/>' +
        '<path d="M26 46V22l6-14 4 15v23"/>' +
        '<path d="M42 46V30l5-10 3 10v16"/>' +
        '<path d="M32 30v4M16 34v3M46 36v3"/>' +
        '<path d="M53 8a5 5 0 1 0 4 8 4 4 0 1 1-4-8z"/>' +
        '<path d="M6 51q5-4 10 0t10 0 10 0 10 0 10 0"/>' +
        '<path d="M10 57q5-4 10 0t10 0 10 0 10 0"/>'
    ),
    // An old tree hung with lanterns
    avalon: svg(
      '<path d="M32 58V34"/>' +
        '<path d="M32 58q-6-3-11-1M32 58q6-3 11-1"/>' +
        '<path d="M32 40q-9-9-20-9M32 36q11-10 22-8M32 34q-2-14 2-26"/>' +
        '<path d="M16 31v6M48 28v7"/>' +
        '<rect x="13" y="37" width="6" height="7" rx="1.5" fill="currentColor" fill-opacity="0.35"/>' +
        '<rect x="45" y="35" width="6" height="7" rx="1.5" fill="currentColor" fill-opacity="0.35"/>'
    ),
    // A low sun over ash, and the ribs of something buried
    wastes: svg(
      '<path d="M20 38a12 12 0 0 1 24 0"/>' +
        '<path d="M32 18v-6M18 24l-4-4M46 24l4-4M12 36H6M52 36h6"/>' +
        '<path d="M4 46q14-6 28-2t28-2"/>' +
        '<path d="M4 56h56"/>' +
        '<path d="M16 56q2-9 7-10M24 56q2-11 8-12M33 56q2-9 7-10"/>'
    ),
    // An open book under the sea, rising bubbles
    lyonesse: svg(
      '<path d="M8 40q12-6 24 0 12-6 24 0v12q-12-6-24 0-12-6-24 0z"/>' +
        '<path d="M32 40v12"/>' +
        '<path d="M6 26q6-4 12 0t12 0 12 0 12 0 12 0"/>' +
        '<circle cx="24" cy="16" r="2"/><circle cx="30" cy="9" r="1.5"/><circle cx="41" cy="15" r="2.5"/>'
    ),
    // The tower with one open eye, among cold stars
    spire: svg(
      '<path d="M25 58l3-40 4-12 4 12 3 40z"/>' +
        '<path d="M28.5 31q3.5-4 7 0-3.5 4-7 0z"/>' +
        '<circle cx="32" cy="31" r="1" fill="currentColor"/>' +
        '<path d="M14 58h36"/>' +
        '<path d="M12 12v6M9 15h6M51 8v6M48 11h6M52 28v4M50 30h4"/>'
    ),
  };

  const NEMESIS_SIGILS = {
    // The Witch-Hunter General: the Pale Flame on a shield
    green_knight: svg(
      '<path d="M32 7l20 6v16q0 17-20 27Q12 46 12 29V13z"/>' +
        '<path d="M32 45q-9-5-5-16 2 6 5 4-2-9 5-15-2 10 4 14 0 9-9 13z"/>'
    ),
    // The Lich of Ashvault: a crowned skull
    mordred: svg(
      '<path d="M18 22l4-10 5 6 5-10 5 10 5-6 4 10z"/>' +
        '<path d="M18 31q0-9 14-9t14 9v9q0 4-6 4v6H24v-6q-6 0-6-4z"/>' +
        '<circle cx="25" cy="33" r="3.5" fill="currentColor"/><circle cx="39" cy="33" r="3.5" fill="currentColor"/>' +
        '<path d="M32 37l-2 4h4z"/><path d="M28 46v4M32 46v4M36 46v4"/>'
    ),
    // The Bone Wyrm: a coiled spine with ribs
    questing_beast: svg(
      '<path d="M12 48q0-28 22-28 18 0 18 16 0 12-14 12-10 0-10-10 0-8 8-8"/>' +
        '<path d="M8 38h8M17 21l4 7M34 15v9M44 28l8-6M48 38h8M41 44v8"/>' +
        '<path d="M12 48l-6 5M12 48l2 7"/>'
    ),
    // The Drowned Archmage: a hooded shape rising from the water
    drowned_king: svg(
      '<path d="M32 8q-16 6-16 28v14h32V36q0-22-16-28z"/>' +
        '<path d="M24 30q8-8 16 0 0 10-8 12-8-2-8-12z" fill="currentColor" fill-opacity="0.3"/>' +
        '<circle cx="28.5" cy="31" r="1.2" fill="currentColor"/><circle cx="35.5" cy="31" r="1.2" fill="currentColor"/>' +
        '<path d="M6 55q6-4 12 0t12 0 12 0 12 0 6 0"/>' +
        '<circle cx="50" cy="16" r="2"/><circle cx="55" cy="9" r="1.5"/>'
    ),
    // The Archmage of the White College: the eye that signed your expulsion
    archmage: svg(
      '<path d="M32 9l22 40H10z"/>' +
        '<path d="M20 37q12-11 24 0-12 10-24 0z"/>' +
        '<circle cx="32" cy="37" r="3.5" fill="currentColor"/>' +
        '<path d="M32 4V1M58 52l4 2M6 52l-4 2"/>'
    ),
  };

  const FACTION_SIGILS = {
    // The Covens: a crescent over a cauldron
    covens: svg(
      '<path d="M38 8a14 14 0 1 0 12 22 11 11 0 1 1-12-22z"/>' +
        '<path d="M14 40h30q0 15-15 15T14 40z"/>' +
        '<path d="M18 55l-3 4M40 55l3 4"/>'
    ),
    // The Restless Dead: a skull over crossed bones
    dead: svg(
      '<path d="M22 24q0-14 10-14t10 14v6H22z"/>' +
        '<circle cx="27.5" cy="22" r="2.5" fill="currentColor"/><circle cx="36.5" cy="22" r="2.5" fill="currentColor"/>' +
        '<path d="M26 30v4M32 30v4M38 30v4"/>' +
        '<path d="M14 54l36-14M14 40l36 14"/>' +
        '<circle cx="12" cy="39" r="2.5"/><circle cx="52" cy="39" r="2.5"/>' +
        '<circle cx="12" cy="55" r="2.5"/><circle cx="52" cy="55" r="2.5"/>'
    ),
    // The Order of the Pale Flame: the flame itself
    order: svg(
      '<path d="M32 54q-14-6-10-22 3 7 7 6-4-14 9-28-2 14 6 20 3-4 2-9 8 9 6 19-2 10-20 14z"/>' +
        '<path d="M22 58h20"/>'
    ),
  };

  return { REGION_SIGILS: REGION_SIGILS, NEMESIS_SIGILS: NEMESIS_SIGILS, FACTION_SIGILS: FACTION_SIGILS };
});

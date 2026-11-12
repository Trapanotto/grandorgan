// Shared geometry contract for the Royal Albert Hall organ scene.
// Units: metres. Y up. The organ facade faces +Z and is centred on x = 0.
// y = 0 is the organ gallery floor; the case front plane is z = 0, the case
// extends back to z = -caseDepth.

export const LAYOUT = {
  caseWidth: 20,        // x from -10 to +10
  caseDepth: 5,         // z from -5 to 0
  totalHeight: 21,      // highest pipe tops (no casework up there)
  baseHeight: 5.2,      // pale oak base storey (plinth, panels, pierced grilles, frieze, cornice) up to the impost

  // FACADE (rebuilt after photographs of the real instrument).
  // The real front has NO upper casework: a pale oak base storey with pierced
  // grilles carries (a) three big round arches on stout decorated columns, with
  // small pipes standing in a V inside each arch recess, and (b) between and
  // outside the arches free-standing groups of very large pipes on stepped
  // plinths, framed by slender polychrome posts. Pipe tops are open to the hall.
  //
  // kind 'cluster': free-standing big pipes in a shallow forward-bowed row,
  //   pipe axes within z in [0.05, 0.75]; `plinthH` = height of the stepped oak
  //   plinth they stand on (pipe toes at impostY + plinthH).
  // kind 'arch': round arch in the plane z = 0. Columns stand at x +- (width/2 - colR),
  //   column height `springH` above impostY, semicircular arch of inner radius
  //   `archR` above that. The recess behind is `recessDepth` deep with a dark
  //   back. Pipes stand INSIDE the recess (axes at z <= -0.30): a front row in a
  //   V (tallest next to the columns, shortest in the middle) on a toe-board at
  //   impostY + toeH, and optionally taller rows behind.
  // rank / notes: which real pipes these are. `rank` is a stop id from
  //   stoplist.js; note index 0 = that stop's own bottom C, negative indices =
  //   its downward (32 ft) extension pipes. Pipe BODY length must follow pitch:
  //   L = (pitchFt * 0.3048 m) * 2^(-note/12)  (32 ft C = 9.75 m), plus the foot.
  //   notes are listed in left-to-right order.
  postW: 0.22,          // slender decorated posts framing every section
  sections: [
    { id: 'outerL',   kind: 'cluster', x: -8.6, width: 2.8, impostY: 5.2, plinthH: 0.5, rank: 'pedal-open-diapason-ii', pitchFt: 16, notes: [2, -2, -6, -4, 0] },
    { id: 'archL',    kind: 'arch',    x: -5.6, width: 3.2, impostY: 5.2, colR: 0.2, springH: 3.3, archR: 1.4, recessDepth: 1.3, toeH: 0.35, rank: 'great-open-diapason-1', pitchFt: 8, notes: [0, 4, 8, 12, 16, 20, 24, 22, 18, 14, 10, 6, 2] },
    { id: 'clusterL', kind: 'cluster', x: -2.9, width: 2.2, impostY: 5.2, plinthH: 0.5, rank: 'pedal-open-diapason-ii', pitchFt: 16, notes: [-8, -12, -10] },
    { id: 'archC',    kind: 'arch',    x: 0.0,  width: 3.6, impostY: 5.2, colR: 0.22, springH: 3.6, archR: 1.58, recessDepth: 1.3, toeH: 0.35, rank: 'great-open-diapason-2', pitchFt: 8, notes: [0, 2, 4, 6, 8, 10, 12, 11, 9, 7, 5, 3, 1] },
    { id: 'clusterR', kind: 'cluster', x: 2.9,  width: 2.2, impostY: 5.2, plinthH: 0.5, rank: 'pedal-open-diapason-ii', pitchFt: 16, notes: [-9, -11, -7] },
    { id: 'archR',    kind: 'arch',    x: 5.6,  width: 3.2, impostY: 5.2, colR: 0.2, springH: 3.3, archR: 1.4, recessDepth: 1.3, toeH: 0.35, rank: 'great-open-diapason-1', pitchFt: 8, notes: [1, 5, 9, 13, 17, 21, 25, 23, 19, 15, 11, 7, 3] },
    { id: 'outerR',   kind: 'cluster', x: 8.6,  width: 2.8, impostY: 5.2, plinthH: 0.5, rank: 'pedal-open-diapason-ii', pitchFt: 16, notes: [1, -3, -5, -1, 3] },
  ],
  // Side and back walls of the organ chamber above the base rise only to this
  // height (plain dark screens); above that the interior pipework is open.
  screenTopY: 9.0,

  // Console: origin of the console group on the gallery floor. The organist
  // faces -Z (towards the organ); the bench is on the +Z side.
  console: { x: 0, y: 0, z: 2.3, maxWidth: 3.0, maxDepth: 2.6, maxHeight: 2.0 },

  // Organ gallery floor slab and surroundings (for the choir/hall module).
  gallery: { xMin: -14, xMax: 14, zMin: -6, zMax: 4.5 },
  // Choir tiers descend in front of the gallery from y = 0 down to the stage.
  choir: { zStart: 4.5, zEnd: 13.0, steps: 8, stepDrop: 0.5, halfWidth: 14 },
  stageY: -4.0,
  // Volume reserved for organ + console; the hall module must keep it empty.
  reserved: { xMin: -10.6, xMax: 10.6, yMin: 0, yMax: 22, zMin: -5.5, zMax: 4.3 },
};

// Note numbering used on the event bus (MIDI numbers).
export const MANUALS = ['Choir', 'Great', 'Swell', 'Solo']; // index 0 = lowest keyboard
export const PEDAL = 4;               // manual index used for the pedalboard
export const MANUAL_RANGE = [36, 96]; // C2..C7, 61 keys
export const PEDAL_RANGE = [36, 67];  // 32 keys, C..g'; audio sounds them an octave lower

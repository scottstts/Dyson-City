/**
 * The shot list: nine 5 s clips. Two high over the Dome (the ceiling is ~2× the Dome's 250 m
 * crown), one on the Dyson sphere's shell, six close inside the Dome. World frame: the Dome is
 * centred on the origin, x east, z south, the platform top at y 1.2. See path.mjs for the keys.
 */
export const SHOTS = [
  {
    name: '01-above-west',
    // From high over the deck west of the West Gate, drifting in toward the Dome.
    from: { pos: [-800, 500, 250], look: [0, 40, 0], fov: 40 },
    to: { pos: [-740, 490, 228], look: [0, 40, 0], fov: 39 },
  },
  {
    name: '02-above-crown',
    // Over the south-east quarter, a slow orbit looking down across the crown.
    orbit: { centre: [0, 0], radius: [620, 610], angle: [55, 68], height: [480, 470] },
    look: [[0, 40, 0], [0, 40, 0]],
    fov: [42, 41],
  },
  {
    name: '03-sphere',
    // The far shell rising beyond the horizon: a slow pan along it, clear of the star's glare.
    from: { pos: [-700, 300, -500], look: [-2700, 1600, -2300], fov: 40 },
    to: { pos: [-700, 300, -500], look: [-2000, 1600, -2900], fov: 40 },
  },
  {
    name: '04-mast',
    // From inside the Halo's ring, craning up toward the Mast.
    from: { pos: [30, 6, 30], look: [150, 55, -72], fov: 46 },
    to: { pos: [45, 13, 18], look: [150, 58, -72], fov: 44 },
  },
  {
    name: '05-resonator',
    // A slow orbit past the Resonator's ring, the towers turning behind it.
    orbit: { centre: [-97, 290], radius: [130, 128], angle: [38, 52], height: [16, 20] },
    look: [[-97, 58, 290], [-97, 58, 290]],
    fov: [44, 44],
  },
  {
    name: '06-gyre',
    // The Gyre's gimbal across its precinct, a slow lateral drift and rising look.
    from: { pos: [20, 22, -200], look: [96, 54, -288], fov: 44 },
    to: { pos: [34, 24, -196], look: [96, 58, -288], fov: 44 },
  },
  {
    name: '07-car',
    // Low round the car parked on the Gate Court.
    orbit: { centre: [-452, -20], radius: [9, 8.5], angle: [20, 45], height: [2.6, 2.6] },
    look: [[-452, 1.9, -20], [-452, 1.9, -20]],
    fov: [40, 40],
  },
  {
    name: '08-estate-pond',
    // Craning over the hedges onto the pond garden.
    from: { pos: [-322, 7, -128], look: [-322, 2.6, -150], fov: 46 },
    to: { pos: [-312, 8.5, -130], look: [-322, 2.6, -150], fov: 46 },
  },
  {
    name: '09-house-front',
    // From the front lawn, pushing slowly in on the house.
    from: { pos: [-352, 4.4, -100], look: [-372, 9, -112], fov: 44 },
    to: { pos: [-356, 4.3, -102.5], look: [-372, 9, -112], fov: 42 },
  },
];

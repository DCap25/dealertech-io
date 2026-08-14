import type { Explainer } from './types'

/**
 * The explainer library.
 *
 * Content, not code. Every figure here is a property of the part — pad
 * thickness when new, the tread depth at which wet braking falls away, the
 * temperature at which wet brake fluid boils — and every one of them is a
 * number a customer could look up and check. That is the standard: if a
 * sceptical customer with a phone can catch us overstating something, the
 * explainer has done more harm than saying nothing.
 */

const LIBRARY: Explainer[] = [
  {
    key: 'BRAKE_PADS_SHOES',
    title: 'How brake pads wear',
    diagram: 'LAYER_WEAR',
    scale: {
      unit: 'mm',
      unitLabel: 'millimetres of friction material',
      fresh: 12,
      present: 4,
      limit: 2,
      limitMeans: 'the backing plate starts contacting the rotor',
    },
    scenes: [
      { holdMs: 4500, caption: 'A brake pad presses against a spinning steel rotor to slow the car. Every stop takes a little material off the pad.' },
      { holdMs: 4500, caption: 'New pads carry around 12mm of friction material. Most makers suggest replacing at about 4mm.' },
      { holdMs: 5000, caption: 'Below roughly 2mm the friction material is gone and the pad’s steel backing meets the rotor.' },
      { holdMs: 4500, caption: 'That is the point where a pad replacement becomes a pad and rotor replacement.' },
    ],
    ifIgnored:
      'Pads are the cheap part. Once the material is gone, the rotor is machined or replaced too, which is roughly double the job.',
  },
  {
    key: 'TIRES',
    title: 'What tread depth does',
    diagram: 'LAYER_WEAR',
    scale: {
      unit: '32nds',
      unitLabel: 'thirty-seconds of an inch',
      fresh: 11,
      present: 4,
      limit: 2,
      limitMeans: 'the legal minimum in most states',
    },
    scenes: [
      { holdMs: 4500, caption: 'Tread grooves exist to move water out from under the tyre so the rubber can touch the road.' },
      { holdMs: 5000, caption: 'As the grooves get shallower they move less water. Wet stopping distance grows long before the tyre looks worn out.' },
      { holdMs: 5000, caption: 'Most tyre makers recommend replacing at 4/32". The legal minimum in most states is 2/32".' },
      { holdMs: 4500, caption: 'Dry grip barely changes. This is entirely about rain, and about how much warning you get.' },
    ],
    ifIgnored:
      'A tyre at 2/32" still stops fine in the dry. In standing water it stops taking a usefully longer distance, which is the situation you cannot plan for.',
  },
  {
    key: 'OIL_CHANGE',
    title: 'What engine oil is doing',
    diagram: 'FLUID_LIFE',
    scenes: [
      { holdMs: 4500, caption: 'Oil keeps a film between metal parts moving against each other thousands of times a minute.' },
      { holdMs: 5000, caption: 'Heat and combustion by-products break down the additives that let it do that, and it collects the debris it is designed to carry.' },
      { holdMs: 4500, caption: 'The interval on your car is set by the manufacturer for your engine and how it is driven.' },
      { holdMs: 4000, caption: 'Oil that looks dark is not automatically due. The mileage and the maker’s schedule are what decide.' },
    ],
    ifIgnored:
      'Long-overdue oil thickens with deposits and stops flowing into the tightest clearances, which is where wear starts.',
  },
  {
    key: 'BRAKE_FLUID_SERVICE',
    title: 'Why brake fluid is replaced',
    diagram: 'FLUID_LIFE',
    scenes: [
      { holdMs: 4500, caption: 'Brake fluid is not compressible, which is how your foot moves a caliper. It also absorbs water from the air over time.' },
      { holdMs: 5000, caption: 'Water lowers the temperature at which the fluid boils. Fresh fluid boils around 230°C; fluid with 3% water is nearer 140°C.' },
      { holdMs: 5000, caption: 'Boiled fluid makes vapour, and vapour compresses. That is a pedal that goes closer to the floor after repeated hard braking.' },
      { holdMs: 4000, caption: 'It happens on a long descent or in traffic on a hot day, not in normal driving.' },
    ],
    ifIgnored:
      'Nothing changes day to day. The difference shows up on the one occasion you need the brakes repeatedly and hard.',
  },
  {
    key: 'COOLANT_SERVICE',
    title: 'What coolant protects',
    diagram: 'FLUID_LIFE',
    scenes: [
      { holdMs: 4500, caption: 'Coolant moves heat out of the engine, and carries additives that stop the metal it touches from corroding.' },
      { holdMs: 5000, caption: 'Those corrosion inhibitors deplete on a schedule of their own, whether or not the coolant still looks correct.' },
      { holdMs: 5000, caption: 'Once they are gone, the radiator, water pump and heater core start corroding from the inside.' },
      { holdMs: 4000, caption: 'Colour is not a reliable guide. The service interval is.' },
    ],
    ifIgnored:
      'The failures that follow depleted coolant — water pump, radiator, heater core — cost considerably more than the fluid service does.',
  },
  {
    key: 'TRANS_FLUID_SERVICE',
    title: 'What transmission fluid does',
    diagram: 'FLUID_LIFE',
    scenes: [
      { holdMs: 4500, caption: 'Automatic transmission fluid is a hydraulic fluid, a coolant and a friction surface all at once.' },
      { holdMs: 5000, caption: 'Its friction properties are tuned tightly, and heat degrades them. Clutch packs then engage less cleanly.' },
      { holdMs: 5000, caption: 'Debris from normal clutch wear stays in the fluid and circulates through the valve body.' },
      { holdMs: 4000, caption: 'Intervals vary widely by transmission. Some makers call for it; some call the fill lifetime.' },
    ],
    ifIgnored:
      'Transmission repair is one of the largest bills in the shop, which is the whole argument for the fluid service.',
  },
  {
    key: 'ENGINE_AIR_FILTER',
    title: 'What the air filter is for',
    diagram: 'FLOW_RESTRICTION',
    scenes: [
      { holdMs: 4500, caption: 'Your engine pulls in thousands of litres of air for every litre of fuel. The filter keeps grit out of the cylinders.' },
      { holdMs: 5000, caption: 'As it loads with dust it restricts airflow, and the engine has to work harder to breathe.' },
      { holdMs: 5000, caption: 'A modern engine measures the air it gets and adjusts, so a dirty filter usually feels like nothing at all.' },
    ],
    ifIgnored:
      'This is a maintenance item, not a failure risk. It is replaced on schedule because it is cheap and because grit past the filter is not.',
    candour:
      'You may have heard a new air filter improves fuel economy. On a modern fuel-injected engine that effect is very small — replace it on schedule for engine protection, not for MPG.',
  },
  {
    key: 'CABIN_AIR_FILTER',
    title: 'What the cabin filter does',
    diagram: 'FLOW_RESTRICTION',
    scenes: [
      { holdMs: 4000, caption: 'The cabin filter cleans the air coming through your vents — dust, pollen, and what the car in front is emitting.' },
      { holdMs: 4500, caption: 'When it loads up, airflow from the vents drops and the system can smell musty.' },
      { holdMs: 4500, caption: 'It sits behind the glovebox on most cars and takes a few minutes to change.' },
    ],
    ifIgnored:
      'Nothing mechanical. Weaker airflow, more smell, and more of what is outside the car ending up inside it.',
    candour:
      'This one is comfort and air quality, not safety or reliability. It matters most if someone in the car has allergies.',
  },
  {
    key: 'BATTERY_12V',
    title: 'How a battery fails',
    diagram: 'CAPACITY_FADE',
    scenes: [
      { holdMs: 4500, caption: 'A battery stores enough energy to turn the engine over. That capacity falls gradually from the day it is made.' },
      { holdMs: 5000, caption: 'Heat is what ages it fastest, so hot summers do more damage than cold winters do.' },
      { holdMs: 5000, caption: 'Cold weather is when it shows. Starting takes more current exactly when the battery can deliver least.' },
      { holdMs: 4000, caption: 'A tested battery gives a reading. It is one of the few parts whose remaining life can be measured rather than guessed.' },
    ],
    ifIgnored:
      'Batteries rarely warn you. The usual sequence is that it starts normally until the morning it does not.',
  },
  {
    key: 'WHEEL_ALIGNMENT',
    title: 'What alignment changes',
    diagram: 'GEOMETRY',
    scenes: [
      { holdMs: 4500, caption: 'Alignment is the set of angles your wheels sit at. Kerbs, potholes and worn suspension parts move them.' },
      { holdMs: 5000, caption: 'A wheel that points even slightly off is dragged sideways as it rolls, scrubbing rubber off as it goes.' },
      { holdMs: 5000, caption: 'The tell is uneven wear — one edge of the tread disappearing while the rest looks fine.' },
      { holdMs: 4000, caption: 'The car may drive straight the whole time. Alignment is not the same thing as pulling.' },
    ],
    ifIgnored:
      'A set of tyres worn out early by alignment costs several times what correcting the alignment does.',
  },
  {
    key: 'TIRE_ROTATION',
    title: 'Why tyres get rotated',
    diagram: 'GEOMETRY',
    scenes: [
      { holdMs: 4000, caption: 'The wheels that drive and steer your car wear faster than the ones that only roll.' },
      { holdMs: 4500, caption: 'Left alone, one pair wears out well before the other, and you replace tyres in pairs more often.' },
      { holdMs: 4500, caption: 'Moving them around at intervals evens the wear out so a set reaches the end together.' },
    ],
    ifIgnored:
      'You still get where you are going. You just buy tyres more often than you needed to.',
  },
  {
    key: 'SPARK_PLUGS',
    title: 'How spark plugs wear',
    diagram: 'IGNITION',
    scenes: [
      { holdMs: 4500, caption: 'A spark plug jumps a spark across a gap, tens of times a second, for years.' },
      { holdMs: 5000, caption: 'Each spark erodes a little metal from the electrodes, and the gap slowly widens.' },
      { holdMs: 5000, caption: 'A wider gap needs more voltage. The coil supplies it until the day it cannot, usually under load.' },
      { holdMs: 4000, caption: 'That is a misfire — a stumble on acceleration, or a check engine light.' },
    ],
    ifIgnored:
      'Sustained misfiring puts unburnt fuel into the exhaust, and a catalytic converter is an expensive thing to damage that way.',
  },
]

const BY_KEY = new Map(LIBRARY.map((e) => [e.key, e]))

export function explainerFor(componentGroupKey: string | null | undefined): Explainer | null {
  if (!componentGroupKey) return null
  return BY_KEY.get(componentGroupKey) ?? null
}

export function allExplainers(): Explainer[] {
  return [...LIBRARY]
}

/** Total run time. Used to size the progress bar and to assert the brief. */
export function totalDurationMs(explainer: Explainer): number {
  return explainer.scenes.reduce((sum, s) => sum + s.holdMs, 0)
}

/**
 * Which scene is showing at `elapsedMs`, and how far through the whole
 * explainer we are.
 *
 * Clamps rather than wrapping: a player that loops back to the start on its
 * own steals the tablet back from whoever is reading it.
 */
export function sceneAt(
  explainer: Explainer,
  elapsedMs: number,
): { index: number; caption: string; progress: number; done: boolean } {
  const total = totalDurationMs(explainer)
  const clamped = Math.max(0, Math.min(elapsedMs, total))

  let acc = 0
  let index = 0
  for (let i = 0; i < explainer.scenes.length; i++) {
    acc += explainer.scenes[i]!.holdMs
    index = i
    if (clamped < acc) break
  }

  return {
    index,
    caption: explainer.scenes[index]?.caption ?? '',
    progress: total === 0 ? 1 : clamped / total,
    done: clamped >= total,
  }
}

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
    key: 'TIRE_BALANCE',
    title: 'What balancing corrects',
    diagram: 'GEOMETRY',
    scenes: [
      { holdMs: 4500, caption: 'A wheel and tyre are never perfectly even in weight. Small counterweights on the rim make up the difference.' },
      { holdMs: 5000, caption: 'As the tyre wears, and if a weight is thrown off by a pothole, that balance drifts.' },
      { holdMs: 5000, caption: 'An unbalanced wheel bounces very slightly at speed. You feel it as a vibration through the wheel or the seat at highway speeds.' },
      { holdMs: 4000, caption: 'Because the bounce lands on the same patch of tread each rotation, it also wears the tyre in a scalloped pattern.' },
    ],
    ifIgnored:
      'The vibration itself does no harm. What it costs is tread — a wheel out of balance wears its tyre unevenly, and that tyre is replaced sooner.',
    candour:
      'If you feel nothing at highway speed, this one is optional. It is usually worth doing with new tyres or a rotation rather than on its own.',
  },
  {
    key: 'WIPER_BLADES',
    title: 'How wiper blades fail',
    diagram: 'LAYER_WEAR',
    scenes: [
      { holdMs: 4500, caption: 'A wiper works by dragging one thin, sharp rubber edge across the glass, flexing it over at the end of each stroke.' },
      { holdMs: 5000, caption: 'Sunlight and heat harden that rubber. A blade ages sitting in a car park as much as it does in use.' },
      { holdMs: 5000, caption: 'Once the edge stops flexing cleanly it leaves streaks, chatters, or lifts off the glass entirely.' },
      { holdMs: 4000, caption: 'Most blades reach that point in about a year, which is why they are usually replaced by time rather than by mileage.' },
    ],
    ifIgnored:
      'Streaking gets worse until the first hard rain at night, which is when it matters. A hardened blade can also drag grit across the glass and mark it.',
  },
  {
    key: 'POWER_STEERING_PUMP',
    title: 'What power steering fluid does',
    diagram: 'FLUID_LIFE',
    scenes: [
      { holdMs: 4500, caption: 'On a car with hydraulic steering, a belt-driven pump pressurises fluid, and that pressure is what makes the wheel light.' },
      { holdMs: 5000, caption: 'The fluid runs hot and passes through tight clearances in the pump and the steering rack.' },
      { holdMs: 5000, caption: 'Over years it darkens and carries fine metal and seal debris, which is abrasive to the parts it is circulating through.' },
      { holdMs: 4000, caption: 'Newer cars use an electric motor instead and have no fluid to service at all.' },
    ],
    ifIgnored:
      'The usual sequence is a pump that whines, then a rack that seeps. Both are considerably more expensive than the fluid.',
  },
  {
    key: 'DIFF_FLUID_SERVICE',
    title: 'What differential fluid does',
    diagram: 'FLUID_LIFE',
    scenes: [
      { holdMs: 4500, caption: 'The differential lets your driven wheels turn at different speeds through a corner. Its gears mesh by sliding against each other under very high pressure.' },
      { holdMs: 5000, caption: 'Ordinary oil would be squeezed out of that contact. Gear oil carries additives that cling to the metal under load.' },
      { holdMs: 5000, caption: 'Those additives are consumed as they do their job, and normal gear wear leaves fine metal suspended in the oil.' },
      { holdMs: 4000, caption: 'Towing and heavy loads run the differential hotter and use the additives up faster.' },
    ],
    ifIgnored:
      'Differentials are quiet until they are not. The first symptom is usually a whine that rises with road speed, and by then the gears are already worn.',
  },
  {
    key: 'TRANSFER_CASE',
    title: 'What the transfer case does',
    diagram: 'FLUID_LIFE',
    scenes: [
      { holdMs: 4500, caption: 'On an all-wheel or four-wheel drive vehicle, the transfer case splits engine power between the front and rear axles.' },
      { holdMs: 5000, caption: 'Inside it, a chain or a gear set runs constantly in a small amount of fluid — often under a litre.' },
      { holdMs: 5000, caption: 'A small fill means the fluid works hard and degrades faster than the larger volumes elsewhere in the driveline.' },
      { holdMs: 4000, caption: 'A two-wheel drive vehicle has no transfer case, so this service does not exist on one.' },
    ],
    ifIgnored:
      'A worn transfer case chain shows up as a clunk or a shudder when the system engages, and the unit is normally replaced rather than repaired.',
  },
  {
    key: 'PCV_SYSTEM',
    title: 'What the PCV valve does',
    diagram: 'FLOW_RESTRICTION',
    scenes: [
      { holdMs: 4500, caption: 'Some combustion pressure always leaks past the piston rings into the crankcase. It has to go somewhere.' },
      { holdMs: 5000, caption: 'The PCV valve meters those vapours back into the intake to be burnt, instead of venting them or letting pressure build.' },
      { holdMs: 5000, caption: 'The vapours carry oil mist, and over tens of thousands of miles that residue gums the valve up.' },
      { holdMs: 4000, caption: 'A valve stuck shut lets crankcase pressure rise; one stuck open leans the idle mixture.' },
    ],
    ifIgnored:
      'Crankcase pressure with nowhere to go pushes oil past the seals. A rear main seal leak costs many times what the valve does.',
  },
  {
    key: 'ACCESSORY_DRIVE',
    title: 'How a serpentine belt fails',
    diagram: 'LAYER_WEAR',
    scenes: [
      { holdMs: 4500, caption: 'One belt drives the alternator, water pump and air conditioning compressor off the front of the engine.' },
      { holdMs: 5000, caption: 'Modern belts are made of a rubber that does not crack the way older ones did. Instead they wear thin between the ribs.' },
      { holdMs: 5000, caption: 'A worn belt sits deeper in the pulley grooves and starts to slip, which is where the squeal on a cold damp morning comes from.' },
      { holdMs: 4000, caption: 'Because they no longer look bad before they fail, belts are measured with a wear gauge or replaced by interval.' },
    ],
    ifIgnored:
      'When this belt breaks you lose charging and, on most engines, water pump drive. That is a car that stops where it is, not one you drive home.',
  },
  {
    key: 'FUEL_INDUCTION_SERVICE',
    title: 'Why intake valves get cleaned',
    diagram: 'FLOW_RESTRICTION',
    scenes: [
      { holdMs: 4500, caption: 'On an older engine, fuel was sprayed onto the back of the intake valve, and the detergents in petrol washed it clean every time it ran.' },
      { holdMs: 5000, caption: 'A direct-injection engine sprays fuel straight into the cylinder instead. Nothing washes the valve any more.' },
      { holdMs: 5000, caption: 'Oil vapour from the crankcase still passes over it, and bakes onto the hot valve as carbon.' },
      { holdMs: 4500, caption: 'Enough of it disturbs the airflow into the cylinder — usually a rough cold start or a stumble before anything else.' },
    ],
    ifIgnored:
      'Carbon builds slowly over tens of thousands of miles. Left far enough, removing it means taking the intake off and blasting the valves, which is a much larger job.',
    candour:
      'Worth being straight about: if your engine is port-injected rather than direct-injected, petrol detergents already do this and the service has little to offer. And on heavy deposits, a chemical service helps less than the mechanical cleaning does — ask which your engine is.',
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

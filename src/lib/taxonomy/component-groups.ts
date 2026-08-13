import type { System } from './systems'

/**
 * A component group is the atomic unit of a coverage decision.
 *
 * Every op code, VSC coverage line, OEM warranty term, and recall maps to one of
 * these. The eligibility flags are read directly by the arbitration engine, so
 * they encode real coverage rules rather than parts-catalog structure.
 *
 * Where OEMs genuinely disagree (water pump under powertrain is the classic),
 * the flag reflects the MOST COMMON treatment and `coverageNote` records the
 * variance. The engine downgrades confidence when it relies on a group whose
 * `coverageVaries` is true, which is how we avoid stating a wrong answer
 * confidently — see docs/PLAN.md §7 risk 2.
 */
export interface ComponentGroup {
  key: string
  label: string
  system: System

  /** Covered by a typical OEM powertrain warranty (engine/trans/drive internals). */
  powertrainEligible: boolean

  /**
   * Federal Clean Air Act emissions warranty, 8yr/80k. This is a NARROW
   * statutory list: catalytic converter, the engine control module, and the
   * onboard diagnostic device. Nothing else qualifies for the long term.
   */
  emissionsFederalLong: boolean

  /** Federal emissions warranty, 2yr/24k — all other emissions-related parts. */
  emissionsFederalShort: boolean

  /** Hybrid/EV component warranty: 8yr/100k federal, 10yr/150k in CARB states. */
  hybridEvEligible: boolean

  /** Wear item. Essentially never covered by factory warranty or a VSC. */
  wearItem: boolean

  /** Scheduled maintenance — the operations a prepaid maintenance plan redeems against. */
  maintenanceItem: boolean

  /** Covered by a tire & wheel / road hazard policy. */
  tireWheelEligible: boolean

  /** Covered by the OEM corrosion / rust-through warranty rather than basic. */
  corrosionEligible: boolean

  /** True when OEMs or administrators materially disagree about this group. */
  coverageVaries: boolean

  coverageNote?: string

  /** Free-text matching for op codes, tech stories, and customer concerns. */
  aliases: string[]
}

/** Defaults keep the table below readable — only meaningful flags are written out. */
const base = {
  powertrainEligible: false,
  emissionsFederalLong: false,
  emissionsFederalShort: false,
  hybridEvEligible: false,
  wearItem: false,
  maintenanceItem: false,
  tireWheelEligible: false,
  corrosionEligible: false,
  coverageVaries: false,
} as const

function group(
  key: string,
  label: string,
  system: System,
  overrides: Partial<Omit<ComponentGroup, 'key' | 'label' | 'system' | 'aliases'>> = {},
  aliases: string[] = [],
): ComponentGroup {
  return { ...base, key, label, system, aliases, ...overrides }
}

export const COMPONENT_GROUPS: readonly ComponentGroup[] = [
  // ---------------------------------------------------------------- ENGINE
  group('ENGINE_INTERNAL', 'Engine — Internally Lubricated Parts', 'ENGINE',
    { powertrainEligible: true },
    ['engine', 'block', 'cylinder head', 'piston', 'crankshaft', 'camshaft', 'rod bearing', 'timing chain', 'oil pump', 'valvetrain', 'knock', 'rod knock', 'burning oil', 'oil consumption']),
  group('ENGINE_SEALS_GASKETS', 'Engine — Seals & Gaskets', 'ENGINE',
    { powertrainEligible: true, coverageVaries: true,
      coverageNote: 'Usually covered only when replaced in the course of repairing another covered component. Standalone seal/gasket leaks are frequently denied.' },
    ['head gasket', 'valve cover gasket', 'oil pan gasket', 'rear main seal', 'oil leak']),
  group('ENGINE_MOUNTS', 'Engine & Transmission Mounts', 'ENGINE', {},
    ['motor mount', 'engine mount', 'trans mount', 'vibration']),
  group('TURBO_SUPERCHARGER', 'Turbocharger / Supercharger', 'ENGINE',
    { powertrainEligible: true, coverageVaries: true,
      coverageNote: 'Factory-installed only. Aftermarket forced induction voids most powertrain and VSC coverage outright.' },
    ['turbo', 'turbocharger', 'supercharger', 'wastegate', 'boost']),
  group('TIMING_BELT', 'Timing Belt', 'ENGINE',
    { wearItem: true, maintenanceItem: true },
    ['timing belt']),
  group('ACCESSORY_DRIVE', 'Belts, Tensioners & Pulleys', 'ENGINE',
    { wearItem: true, maintenanceItem: true },
    ['serpentine belt', 'drive belt', 'tensioner', 'idler pulley', 'belt squeal']),

  // ---------------------------------------------------------- TRANSMISSION
  group('TRANSMISSION_INTERNAL', 'Transmission — Internal Parts', 'TRANSMISSION',
    { powertrainEligible: true },
    ['transmission', 'gearbox', 'valve body', 'shift solenoid', 'slipping', 'harsh shift', 'wont shift']),
  group('TORQUE_CONVERTER', 'Torque Converter', 'TRANSMISSION',
    { powertrainEligible: true },
    ['torque converter', 'converter shudder']),
  group('TCM', 'Transmission Control Module', 'TRANSMISSION',
    { powertrainEligible: true, coverageVaries: true },
    ['tcm', 'transmission control module']),
  group('CVT_BELT_CHAIN', 'CVT Belt / Chain', 'TRANSMISSION',
    { powertrainEligible: true },
    ['cvt', 'cvt belt', 'variable transmission']),
  group('CLUTCH_ASSEMBLY', 'Clutch Assembly', 'TRANSMISSION',
    { wearItem: true, coverageVaries: true,
      coverageNote: 'Friction disc and pressure plate are wear items and excluded. The hydraulic master/slave cylinders usually ARE covered.' },
    ['clutch', 'clutch disc', 'pressure plate', 'throwout bearing', 'clutch slipping']),
  group('TRANS_COOLER_LINES', 'Transmission Cooler & Lines', 'TRANSMISSION',
    { powertrainEligible: true, coverageVaries: true },
    ['transmission cooler', 'trans lines']),

  // ------------------------------------------------------------ DRIVETRAIN
  group('TRANSFER_CASE', 'Transfer Case', 'DRIVETRAIN',
    { powertrainEligible: true },
    ['transfer case', '4wd', 'four wheel drive']),
  group('DIFFERENTIAL', 'Differential / Final Drive', 'DRIVETRAIN',
    { powertrainEligible: true },
    ['differential', 'rear end', 'ring and pinion', 'final drive', 'diff whine']),
  group('AXLE_SHAFTS_CV', 'Axle Shafts & CV Joints', 'DRIVETRAIN',
    { powertrainEligible: true },
    ['axle', 'cv joint', 'cv axle', 'cv boot', 'clicking turning']),
  group('DRIVESHAFT', 'Driveshaft & U-Joints', 'DRIVETRAIN',
    { powertrainEligible: true },
    ['driveshaft', 'u joint', 'carrier bearing', 'drive line vibration']),
  group('WHEEL_BEARINGS_HUBS', 'Wheel Bearings & Hubs', 'DRIVETRAIN',
    { coverageVaries: true,
      coverageNote: 'Rarely under powertrain despite being a rotating drivetrain part. Usually basic warranty or a mid/high VSC tier.' },
    ['wheel bearing', 'hub assembly', 'humming noise', 'growling']),
  group('AWD_ACTUATORS', 'AWD / 4WD Actuators & Couplings', 'DRIVETRAIN',
    { powertrainEligible: true, coverageVaries: true },
    ['awd coupling', 'haldex', 'locking hub', '4wd actuator']),

  // -------------------------------------------------------------- HYBRID/EV
  group('HV_BATTERY_PACK', 'High-Voltage Battery Pack', 'HYBRID_EV',
    { hybridEvEligible: true },
    ['hybrid battery', 'hv battery', 'traction battery', 'ev battery', 'battery pack', 'reduced range']),
  group('DRIVE_MOTOR', 'Drive Motor / Generator', 'HYBRID_EV',
    { hybridEvEligible: true, powertrainEligible: true },
    ['drive motor', 'traction motor', 'mg1', 'mg2', 'generator']),
  group('POWER_INVERTER', 'Inverter / DC-DC Converter', 'HYBRID_EV',
    { hybridEvEligible: true },
    ['inverter', 'dc dc converter', 'power electronics']),
  group('HV_BATTERY_COOLING', 'HV Battery Thermal Management', 'HYBRID_EV',
    { hybridEvEligible: true, coverageVaries: true },
    ['battery cooling', 'battery fan', 'thermal management']),
  group('ONBOARD_CHARGER', 'Onboard Charger', 'HYBRID_EV',
    { hybridEvEligible: true },
    ['onboard charger', 'wont charge', 'charging fault']),
  group('CHARGE_PORT', 'Charge Port & Cable', 'HYBRID_EV',
    { hybridEvEligible: true, coverageVaries: true },
    ['charge port', 'charging cable', 'evse']),

  // -------------------------------------------------------------------- FUEL
  // "no start" and "misfire" are deliberately absent — they are symptoms with
  // several plausible causes, and letting one group own them produces confident
  // wrong answers. Symptom-to-many-candidates is modelled separately.
  group('FUEL_PUMP', 'Fuel Pump & Sending Unit', 'FUEL', {},
    ['fuel pump', 'sending unit', 'fuel gauge', 'stalling']),
  group('FUEL_INJECTORS', 'Fuel Injectors', 'FUEL',
    { emissionsFederalShort: true },
    ['injector', 'fuel injector', 'rough idle']),
  group('FUEL_TANK_LINES', 'Fuel Tank & Lines', 'FUEL',
    { emissionsFederalShort: true },
    ['fuel tank', 'fuel line', 'fuel smell']),
  group('FUEL_FILTER', 'Fuel Filter', 'FUEL',
    { maintenanceItem: true, wearItem: true },
    ['fuel filter']),

  // ----------------------------------------------------------------- COOLING
  group('RADIATOR', 'Radiator', 'COOLING', {},
    ['radiator', 'overheating', 'coolant leak']),
  group('WATER_PUMP', 'Water Pump', 'COOLING',
    { powertrainEligible: true, coverageVaries: true,
      coverageNote: 'Genuinely brand-dependent. Many OEMs include it under powertrain as an engine-driven component; others treat it as basic-warranty only. Verify before quoting.' },
    ['water pump', 'coolant pump']),
  group('THERMOSTAT', 'Thermostat & Housing', 'COOLING', {},
    ['thermostat', 'running cold', 'temp gauge']),
  group('COOLING_FAN', 'Cooling Fan & Module', 'COOLING', {},
    ['cooling fan', 'radiator fan', 'fan clutch']),
  group('HOSES_CLAMPS', 'Hoses & Clamps', 'COOLING',
    { wearItem: true },
    ['radiator hose', 'heater hose', 'coolant hose']),

  // -------------------------------------------------------------- ELECTRICAL
  group('ALTERNATOR', 'Alternator', 'ELECTRICAL',
    { coverageNote: 'NOT a powertrain component despite being engine-driven. Advisors misroute this one constantly.' },
    ['alternator', 'charging system', 'battery light', 'not charging']),
  group('STARTER', 'Starter Motor', 'ELECTRICAL',
    { coverageNote: 'NOT a powertrain component.' },
    ['starter', 'starter motor', 'click no crank', 'wont crank']),
  group('BATTERY_12V', '12-Volt Battery', 'ELECTRICAL',
    { coverageVaries: true,
      coverageNote: 'Typically covered under basic warranty for a limited period, often prorated. Most VSCs exclude it entirely.' },
    ['battery', '12v battery', 'dead battery', 'battery dead', 'wont start']),
  group('WIRING_HARNESS', 'Wiring Harness & Connectors', 'ELECTRICAL', {},
    ['wiring', 'harness', 'connector', 'short circuit', 'electrical gremlin']),
  group('FUSES_RELAYS', 'Fuses & Relays', 'ELECTRICAL', {},
    ['fuse', 'relay', 'fuse box']),
  group('LIGHTING_EXTERIOR', 'Exterior Lighting', 'ELECTRICAL', {},
    ['headlight', 'taillight', 'turn signal', 'led headlight', 'fog light']),
  group('BULBS', 'Bulbs', 'ELECTRICAL',
    { wearItem: true },
    ['bulb', 'light bulb', 'burned out']),
  group('POWER_ACCESSORIES', 'Power Windows, Locks, Seats & Mirrors', 'ELECTRICAL', {},
    ['power window', 'window regulator', 'door lock actuator', 'power seat', 'power mirror']),
  group('HORN', 'Horn', 'ELECTRICAL', {}, ['horn']),

  // ------------------------------------------------------ EXHAUST & EMISSIONS
  group('CATALYTIC_CONVERTER', 'Catalytic Converter', 'EXHAUST_EMISSIONS',
    { emissionsFederalLong: true,
      coverageNote: 'Federal 8yr/80k emissions warranty. Frequently missed — an out-of-basic-warranty vehicle can still get a free converter.' },
    ['catalytic converter', 'cat converter', 'p0420', 'p0430', 'check engine emissions']),
  group('ECM_PCM', 'Engine Control Module / PCM', 'EXHAUST_EMISSIONS',
    { emissionsFederalLong: true,
      coverageNote: 'Federal 8yr/80k emissions warranty as the emissions control unit.' },
    ['ecm', 'pcm', 'engine computer', 'powertrain control module']),
  group('OBD_MODULE', 'Onboard Diagnostic Device', 'EXHAUST_EMISSIONS',
    { emissionsFederalLong: true },
    ['obd', 'onboard diagnostic', 'diagnostic module']),
  group('OXYGEN_SENSORS', 'Oxygen / Air-Fuel Sensors', 'EXHAUST_EMISSIONS',
    { emissionsFederalShort: true },
    ['o2 sensor', 'oxygen sensor', 'air fuel sensor', 'lambda']),
  group('EVAP_SYSTEM', 'EVAP System', 'EXHAUST_EMISSIONS',
    { emissionsFederalShort: true },
    ['evap', 'purge valve', 'vent valve', 'gas cap', 'p0442', 'p0455']),
  group('EGR_SYSTEM', 'EGR System', 'EXHAUST_EMISSIONS',
    { emissionsFederalShort: true },
    ['egr', 'egr valve', 'exhaust gas recirculation']),
  group('DIESEL_AFTERTREATMENT', 'Diesel DPF / SCR / DEF', 'EXHAUST_EMISSIONS',
    { emissionsFederalShort: true, coverageVaries: true,
      coverageNote: 'Diesel emissions terms differ substantially from gasoline and are often extended by the OEM. Verify per brand.' },
    ['dpf', 'def', 'scr', 'regen', 'diesel exhaust fluid', 'particulate filter']),
  group('EXHAUST_PIPES_MUFFLER', 'Exhaust Pipes & Muffler', 'EXHAUST_EMISSIONS',
    { corrosionEligible: true, coverageVaries: true },
    ['muffler', 'exhaust', 'exhaust leak', 'resonator', 'loud exhaust']),
  group('PCV_SYSTEM', 'PCV System', 'EXHAUST_EMISSIONS',
    { emissionsFederalShort: true },
    ['pcv', 'crankcase ventilation']),

  // ---------------------------------------------------------------- STEERING
  group('STEERING_RACK', 'Steering Rack / Gearbox', 'STEERING', {},
    ['steering rack', 'rack and pinion', 'steering gear', 'steering leak']),
  group('POWER_STEERING_PUMP', 'Power Steering Pump', 'STEERING', {},
    ['power steering pump', 'steering whine', 'hard steering']),
  group('STEERING_COLUMN', 'Steering Column & Intermediate Shaft', 'STEERING', {},
    ['steering column', 'intermediate shaft', 'steering clunk', 'tilt steering']),
  group('STEERING_LINKAGE', 'Tie Rods & Steering Linkage', 'STEERING',
    { coverageVaries: true },
    ['tie rod', 'inner tie rod', 'outer tie rod', 'steering linkage', 'play in steering']),
  group('EPS_MOTOR', 'Electric Power Steering Motor & Module', 'STEERING', {},
    ['eps', 'electric power steering', 'steering assist fault']),

  // -------------------------------------------------------------- SUSPENSION
  group('STRUTS_SHOCKS', 'Struts & Shock Absorbers', 'SUSPENSION',
    { coverageVaries: true,
      coverageNote: 'Covered against failure/leakage under basic warranty, but excluded once treated as normal degradation. VSC treatment varies by tier.' },
    ['strut', 'shock', 'shock absorber', 'bouncy ride', 'leaking strut']),
  group('CONTROL_ARMS', 'Control Arms & Bushings', 'SUSPENSION', {},
    ['control arm', 'bushing', 'suspension clunk']),
  group('BALL_JOINTS', 'Ball Joints', 'SUSPENSION', {},
    ['ball joint', 'front end noise']),
  group('SPRINGS', 'Coil & Leaf Springs', 'SUSPENSION',
    { coverageVaries: true },
    ['coil spring', 'leaf spring', 'broken spring', 'sagging']),
  group('SWAY_BAR', 'Sway Bar & End Links', 'SUSPENSION', {},
    ['sway bar', 'stabilizer bar', 'end link', 'rattle over bumps']),
  group('AIR_SUSPENSION', 'Air Suspension', 'SUSPENSION',
    { coverageVaries: true,
      coverageNote: 'A high-cost failure that lower VSC tiers commonly exclude. Always confirm the tier before quoting.' },
    ['air suspension', 'air bag suspension', 'air ride', 'compressor', 'vehicle sagging']),
  group('WHEEL_ALIGNMENT', 'Wheel Alignment', 'SUSPENSION',
    { maintenanceItem: true,
      coverageNote: 'An adjustment, not a repair. Excluded from warranty and VSC after the initial delivery period, but a strong attach with any tire sale.' },
    ['alignment', 'wheel alignment', 'pulling', 'crooked steering wheel', 'uneven tire wear']),

  // ------------------------------------------------------------------ BRAKES
  group('BRAKE_PADS_SHOES', 'Brake Pads & Shoes', 'BRAKES',
    { wearItem: true, maintenanceItem: true },
    ['brake pads', 'brake shoes', 'brake job', 'squeaking brakes', 'grinding brakes', 'brakes']),
  group('BRAKE_ROTORS_DRUMS', 'Brake Rotors & Drums', 'BRAKES',
    { wearItem: true, maintenanceItem: true, coverageVaries: true,
      coverageNote: 'Almost universally a wear item. Warped rotors within the early delivery window are occasionally covered as a defect.' },
    ['rotor', 'brake rotor', 'drum', 'pulsation', 'shaking when braking', 'warped rotor']),
  group('BRAKE_CALIPERS', 'Brake Calipers & Wheel Cylinders', 'BRAKES', {},
    ['caliper', 'wheel cylinder', 'seized caliper', 'dragging brake']),
  group('MASTER_CYLINDER', 'Master Cylinder & Booster', 'BRAKES', {},
    ['master cylinder', 'brake booster', 'soft pedal', 'low pedal']),
  group('BRAKE_LINES', 'Brake Lines & Hoses', 'BRAKES',
    { corrosionEligible: true },
    ['brake line', 'brake hose', 'brake fluid leak']),
  group('ABS_SYSTEM', 'ABS Module & Sensors', 'BRAKES', {},
    ['abs', 'abs light', 'wheel speed sensor', 'traction control light']),
  group('PARKING_BRAKE', 'Parking Brake', 'BRAKES',
    { coverageVaries: true },
    ['parking brake', 'emergency brake', 'ebrake']),

  // -------------------------------------------------------------------- HVAC
  group('AC_COMPRESSOR', 'A/C Compressor', 'HVAC', {},
    ['ac compressor', 'a/c compressor', 'no cold air', 'ac not cooling']),
  group('AC_CONDENSER', 'A/C Condenser', 'HVAC',
    { coverageVaries: true,
      coverageNote: 'Road-debris puncture is a common denial — treated as impact damage, not a defect.' },
    ['condenser', 'ac condenser']),
  group('AC_EVAPORATOR', 'A/C Evaporator', 'HVAC', {},
    ['evaporator', 'evap core', 'ac smell']),
  group('HEATER_CORE', 'Heater Core', 'HVAC', {},
    ['heater core', 'no heat', 'sweet smell', 'foggy windows']),
  group('BLOWER_MOTOR', 'Blower Motor & Resistor', 'HVAC', {},
    ['blower motor', 'blower resistor', 'fan only works on high']),
  group('HVAC_CONTROLS', 'HVAC Controls & Blend Doors', 'HVAC', {},
    ['blend door', 'hvac control', 'actuator clicking', 'temp control']),
  group('CABIN_AIR_FILTER', 'Cabin Air Filter', 'HVAC',
    { maintenanceItem: true, wearItem: true },
    ['cabin filter', 'cabin air filter', 'pollen filter']),

  // ------------------------------------------------------------- ELECTRONICS
  group('INFOTAINMENT', 'Infotainment Head Unit', 'ELECTRONICS', {},
    ['radio', 'head unit', 'infotainment', 'touchscreen', 'screen blank', 'carplay', 'android auto']),
  group('INSTRUMENT_CLUSTER', 'Instrument Cluster', 'ELECTRONICS', {},
    ['cluster', 'instrument panel', 'gauges', 'speedometer']),
  group('AUDIO_SYSTEM', 'Speakers & Amplifier', 'ELECTRONICS', {},
    ['speaker', 'amplifier', 'no sound', 'audio']),
  group('BODY_CONTROL_MODULE', 'Body Control Module', 'ELECTRONICS', {},
    ['bcm', 'body control module']),
  group('TELEMATICS', 'Telematics & Connectivity', 'ELECTRONICS',
    { coverageVaries: true },
    ['telematics', 'onstar', 'uconnect', 'bluelink', 'connected services', 'wifi hotspot']),
  group('KEYS_FOBS', 'Keys, Fobs & Immobilizer', 'ELECTRONICS',
    { coverageVaries: true,
      coverageNote: 'Lost keys are never a warranty item, but a key replacement product may cover them. Defective fobs are a warranty item.' },
    ['key fob', 'remote', 'lost key', 'key replacement', 'immobilizer', 'push button start']),
  group('BACKUP_CAMERA', 'Backup & Surround Cameras', 'ELECTRONICS', {},
    ['backup camera', 'rear camera', 'surround view', 'camera blank']),
  group('CHARGING_PORTS', 'USB & 12V Accessory Ports', 'ELECTRONICS', {},
    ['usb port', 'accessory port', 'cigarette lighter', 'wireless charger']),

  // ------------------------------------------------------------ SAFETY/ADAS
  group('AIRBAG_SRS', 'Airbags & SRS', 'SAFETY_ADAS',
    { coverageNote: 'Airbag recalls are extremely common (Takata). Always check for open campaigns before quoting SRS work.' },
    // "air bag" as two words matters: NHTSA recall components are written
    // "AIR BAGS:FRONTAL:DRIVER SIDE INFLATOR MODULE".
    ['airbag', 'air bag', 'inflator', 'srs', 'airbag light', 'srs light', 'clockspring']),
  group('SEATBELTS', 'Seat Belts & Pretensioners', 'SAFETY_ADAS', {},
    ['seat belt', 'seatbelt', 'pretensioner', 'belt wont retract']),
  group('ADAS_SENSORS', 'ADAS Cameras & Radar', 'SAFETY_ADAS',
    { coverageNote: 'Calibration after glass or suspension work is a real, billable, and frequently forgotten operation.' },
    ['adas', 'lane keep', 'adaptive cruise', 'radar', 'forward collision', 'calibration']),
  group('TPMS', 'TPMS Sensors', 'SAFETY_ADAS',
    { coverageVaries: true,
      coverageNote: 'Sensor batteries are finite and treated as wear once out of basic warranty. Natural attach to any tire sale.' },
    ['tpms', 'tire pressure sensor', 'tpms light', 'low tire light']),
  group('BLIND_SPOT', 'Blind Spot & Parking Sensors', 'SAFETY_ADAS', {},
    ['blind spot', 'bsm', 'parking sensor', 'park assist']),

  // --------------------------------------------------------- BODY (EXTERIOR)
  group('PAINT_FINISH', 'Paint & Finish', 'BODY_EXTERIOR',
    { coverageVaries: true,
      coverageNote: 'Paint defects are covered on a short term (commonly 3yr/36k). Environmental damage, stone chips, and fading are excluded.' },
    ['paint', 'clear coat', 'peeling paint', 'paint defect', 'scratch']),
  group('BODY_PANELS', 'Body Panels & Structure', 'BODY_EXTERIOR', {},
    ['fender', 'quarter panel', 'hood', 'door panel', 'body panel']),
  group('CORROSION', 'Corrosion / Rust-Through', 'BODY_EXTERIOR',
    { corrosionEligible: true,
      coverageNote: 'The corrosion warranty requires actual perforation. Surface rust is not covered.' },
    ['rust', 'corrosion', 'rust through', 'perforation']),
  group('BUMPERS', 'Bumpers & Fascias', 'BODY_EXTERIOR', {},
    ['bumper', 'fascia', 'bumper cover']),
  group('DOOR_HARDWARE', 'Door Handles, Latches & Hinges', 'BODY_EXTERIOR', {},
    ['door handle', 'door latch', 'door wont open', 'hinge', 'door sag']),
  group('MIRRORS', 'Exterior Mirrors', 'BODY_EXTERIOR', {},
    ['mirror', 'side mirror', 'mirror glass']),
  group('WEATHERSTRIPPING', 'Weatherstripping & Seals', 'BODY_EXTERIOR',
    { wearItem: true, coverageVaries: true },
    ['weatherstrip', 'door seal', 'wind noise', 'water leak']),
  group('SUNROOF', 'Sunroof / Moonroof', 'BODY_EXTERIOR',
    { coverageVaries: true,
      coverageNote: 'Drain tube cleaning is maintenance, not warranty — a very common denial and an easy upsell.' },
    ['sunroof', 'moonroof', 'panoramic roof', 'sunroof leak', 'sunroof stuck']),
  group('DENTS_DINGS', 'Dents & Dings', 'BODY_EXTERIOR',
    { coverageNote: 'Never a warranty item. Covered only by a paintless dent repair product.' },
    ['dent', 'ding', 'door ding', 'hail damage', 'pdr']),

  // --------------------------------------------------------- BODY (INTERIOR)
  group('SEATS_UPHOLSTERY', 'Seats & Upholstery', 'BODY_INTERIOR',
    { coverageVaries: true },
    ['seat', 'upholstery', 'leather', 'seat tear', 'seat heater']),
  group('INTERIOR_TRIM', 'Interior Trim & Console', 'BODY_INTERIOR', {},
    ['trim', 'console', 'glove box', 'interior rattle']),
  group('CARPET_HEADLINER', 'Carpet & Headliner', 'BODY_INTERIOR',
    { coverageVaries: true },
    ['carpet', 'headliner', 'sagging headliner']),
  group('DASHBOARD', 'Dashboard', 'BODY_INTERIOR', {},
    ['dashboard', 'dash', 'cracked dash']),

  // ------------------------------------------------------------------- GLASS
  group('WINDSHIELD', 'Windshield', 'GLASS',
    { coverageNote: 'Stone chips and cracks are impact damage, not defects. Covered by a windshield protection product or comprehensive insurance. ADAS recalibration is usually required after replacement.' },
    ['windshield', 'windshield chip', 'cracked windshield', 'rock chip', 'glass']),
  group('SIDE_REAR_GLASS', 'Side & Rear Glass', 'GLASS', {},
    ['side glass', 'rear glass', 'back glass', 'window glass', 'rear defroster']),
  group('WIPER_BLADES', 'Wiper Blades', 'GLASS',
    { wearItem: true, maintenanceItem: true },
    ['wiper blade', 'wipers', 'streaking', 'chattering wipers']),
  group('WIPER_SYSTEM', 'Wiper Motor & Linkage', 'GLASS', {},
    ['wiper motor', 'wiper linkage', 'wipers wont work']),
  group('WASHER_SYSTEM', 'Washer Pump & Nozzles', 'GLASS', {},
    ['washer pump', 'washer nozzle', 'no washer fluid spray']),

  // ---------------------------------------------------------- TIRES & WHEELS
  group('TIRES', 'Tires', 'TIRES_WHEELS',
    { wearItem: true, tireWheelEligible: true,
      coverageNote: 'Excluded from factory warranty and VSC (the tire manufacturer warrants defects). Road hazard damage is covered by a tire & wheel policy, which usually requires remaining tread above a stated minimum.' },
    ['tire', 'tires', 'flat tire', 'road hazard', 'nail in tire', 'tire wear', 'bald tire', 'tread']),
  group('WHEELS_RIMS', 'Wheels & Rims', 'TIRES_WHEELS',
    { tireWheelEligible: true },
    ['wheel', 'rim', 'bent rim', 'curb rash', 'wheel damage']),
  group('TIRE_ROTATION', 'Tire Rotation', 'TIRES_WHEELS',
    { maintenanceItem: true },
    ['rotation', 'tire rotation', 'rotate tires']),
  group('TIRE_BALANCE', 'Tire Balance', 'TIRES_WHEELS',
    { maintenanceItem: true },
    ['balance', 'tire balance', 'vibration at speed', 'shaking at highway speed']),

  // ------------------------------------------------------------- MAINTENANCE
  group('OIL_CHANGE', 'Oil & Filter Change', 'MAINTENANCE',
    { maintenanceItem: true },
    ['oil change', 'lof', 'lube oil filter', 'oil and filter', 'synthetic oil', 'oil life']),
  group('ENGINE_AIR_FILTER', 'Engine Air Filter', 'MAINTENANCE',
    { maintenanceItem: true, wearItem: true },
    ['air filter', 'engine air filter']),
  group('SPARK_PLUGS', 'Spark Plugs & Ignition Coils', 'MAINTENANCE',
    { maintenanceItem: true, emissionsFederalShort: true, coverageVaries: true,
      coverageNote: 'Plugs are scheduled maintenance. Ignition COILS are a failure item and often covered — do not lump them together.' },
    ['spark plug', 'plugs', 'ignition coil', 'coil pack', 'tune up']),
  group('DIAGNOSTIC_SCAN', 'Diagnosis & Scan', 'MAINTENANCE',
    { coverageVaries: true,
      coverageNote: 'Diagnostic time is billable and routinely given away. Most VSC administrators reimburse diag only when the resulting repair is covered — bill it, then credit it if the claim pays.' },
    ['check engine light', 'diagnosis', 'diagnostic', 'scan', 'warning light', 'dash light', 'pull codes']),
  group('TRANS_FLUID_SERVICE', 'Transmission Fluid Service', 'MAINTENANCE',
    { maintenanceItem: true },
    ['transmission service', 'trans fluid', 'atf flush']),
  group('DIFF_FLUID_SERVICE', 'Differential & Transfer Case Fluid Service', 'MAINTENANCE',
    { maintenanceItem: true },
    ['differential service', 'gear oil', 'transfer case service']),
  group('COOLANT_SERVICE', 'Coolant Service', 'MAINTENANCE',
    { maintenanceItem: true },
    ['coolant flush', 'antifreeze service', 'cooling system service']),
  group('BRAKE_FLUID_SERVICE', 'Brake Fluid Service', 'MAINTENANCE',
    { maintenanceItem: true },
    ['brake fluid flush', 'brake fluid service']),
  group('FUEL_INDUCTION_SERVICE', 'Fuel & Induction Cleaning', 'MAINTENANCE',
    { maintenanceItem: true },
    ['induction service', 'fuel system cleaning', 'carbon cleaning', 'walnut blast']),
  group('MULTI_POINT_INSPECTION', 'Multi-Point Inspection', 'MAINTENANCE',
    { maintenanceItem: true },
    ['mpi', 'multi point', 'inspection', 'courtesy inspection']),
  group('STATE_INSPECTION', 'State Safety / Emissions Inspection', 'MAINTENANCE',
    { maintenanceItem: true },
    ['state inspection', 'safety inspection', 'emissions test', 'smog check']),
  group('BATTERY_SERVICE', 'Battery Test & Terminal Service', 'MAINTENANCE',
    { maintenanceItem: true },
    ['battery test', 'battery service', 'terminal cleaning', 'load test']),
] as const

/** O(1) lookup by key. */
const BY_KEY: ReadonlyMap<string, ComponentGroup> = new Map(
  COMPONENT_GROUPS.map((g) => [g.key, g]),
)

export function getComponentGroup(key: string): ComponentGroup | undefined {
  return BY_KEY.get(key)
}

export function componentGroupsBySystem(system: System): ComponentGroup[] {
  return COMPONENT_GROUPS.filter((g) => g.system === system)
}

export type ComponentGroupKey = (typeof COMPONENT_GROUPS)[number]['key']

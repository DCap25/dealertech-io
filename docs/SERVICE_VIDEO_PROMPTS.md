# Service Explainer Videos — Grok Imagine Prompts

**What this is:** one video prompt per service the opportunity engine can put
on a customer menu — the 16 scheduled maintenance intervals plus the 3
measurement-driven services from `src/lib/prep-sheet/build.ts`. Each prompt is
self-contained: paste one block into Grok Imagine as-is.

**Who the videos are for:** the customer holding the tablet — and specifically
the under-35 customer who never took an auto shop class and has never been
shown what a brake pad looks like. The audience assumption in every prompt:
zero mechanical knowledge, high skepticism of upsells, fluent in short
vertical video. The videos exist to answer "is this real or are they selling
me something" in twenty seconds, which is the same question the whole product
exists to answer.

**Voice rules, baked into every prompt (and to hold in any edit):**

- **Show the part.** Most people have never seen an air filter or a brake
  pad. The single highest-value frame is the clean part next to the worn one.
- **Consequence, not fear.** The honest sell is "this is what happens if you
  wait", shown plainly — never sirens, crashes, or a mechanic shaking his
  head. Fear-mongering on the tablet would undo the trust the menu builds.
- **No jargon in overlays.** "Your engine's oil picks up grit as it works"
  beats "viscosity breakdown and particulate contamination".
- **Analogies from their life.** Phone batteries, water filters, running
  shoes, sunscreen — things a 25-year-old already maintains.
- **No prices, no brands, no dealership names.** Prices come from the menu
  beside the video, and they're the store's own. A price burned into a video
  is a quote nobody can stand behind — the exact thing the product exists to
  prevent.
- **Vertical 9:16, 15–30 seconds, text overlays doing the explaining** —
  assume it plays muted on a tablet in a bright service drive.

**Product tie-in:** the app already ships 20 animated in-menu explainers
(`src/lib/explainer/`) keyed by component group, shown *before* the choice
with this vehicle's own measurement. These videos are the richer, generated
companion to the same moment. If they're ever surfaced in-app, the natural
home is the `ExplainerPlayer` alongside the existing animations, keyed the
same way — noted here so the two don't grow into rivals.

---

## The 16 scheduled maintenance intervals

### 1. Oil & Filter Change (`LOF` · every 7,500 miles)

> Vertical 9:16 video, 20 seconds, photorealistic macro cinematography, muted-
> playback friendly with bold clean text overlays. OPEN: golden, honey-clear
> oil pouring in slow motion over polished engine gears, light glinting.
> Overlay: "Oil is your engine's bloodstream." CUT: the same gears three
> seconds later running in oil that is black, gritty, thick like old coffee
> sludge. Overlay: "It picks up grit and burns away as it works. This is what
> 10,000 miles looks like." CUT: split screen — a bright new oil filter cut
> open showing clean white pleats vs. one packed grey with sludge. Overlay:
> "The filter catches what would grind your engine down." CLOSE: engine
> purring, oil golden again. Overlay: "Fresh oil is the cheapest insurance
> your engine will ever get." No people, no dialogue, no prices.

### 2. Tire Rotation (`ROT` · every 7,500 miles)

> Vertical 9:16 video, 20 seconds, clean 3D visualization style with smooth
> camera moves, bold text overlays for muted playback. OPEN: a car seen from
> above, ghosted transparent, its four tires highlighted. The front pair glows
> amber and visibly wears down faster in a 5-second time-lapse — front tires
> shown steering, braking, carrying the engine's weight. Overlay: "Your front
> tires do most of the work — so they wear out first." CUT: animated arrows
> swap front and rear tires in a smooth choreographed rotation pattern.
> Overlay: "Rotating them shares the work." CLOSE: side-by-side time-lapse —
> the rotated set wears evenly and lasts visibly longer than the unrotated
> set, where two tires die early. Overlay: "Same four tires. Thousands of
> miles more. Like rotating your sneakers so one pair doesn't blow out." No
> people, no dialogue, no prices.

### 3. Wiper Blade Replacement (`WIPER` · every 15,000 miles)

> Vertical 9:16 video, 15 seconds, photorealistic, shot from the driver's
> seat, bold text overlays. OPEN: heavy rain at night through a windshield,
> wipers sweeping — but the rubber is cracked and each sweep leaves smeared
> arcs; oncoming headlights bloom into glare through the streaks. Overlay:
> "Wiper rubber bakes in the sun all year. Then you need it in one rainstorm
> at night." CUT: extreme macro of a wiper blade edge — new rubber crisp and
> straight next to old rubber cracked like dried-out earbuds tips. CLOSE: the
> same rainy road through fresh blades, one sweep leaving glass perfectly
> clear, the road ahead obvious. Overlay: "Two minutes to change. The whole
> windshield back." No people, no dialogue, no prices.

### 4. Tire Balance (`BAL` · every 15,000 miles)

> Vertical 9:16 video, 20 seconds, mixed photorealistic and clean 3D cutaway,
> bold text overlays. OPEN: hands at 10-and-2 on a steering wheel at highway
> speed, the wheel buzzing with a fine vibration; a coffee in the cup holder
> shows rings rippling. Overlay: "Feel that buzz at 70? One wheel is a few
> grams heavy on one side." CUT: 3D wheel spinning in slow motion, a small
> glowing weight-imbalance point on the rim dragging the wheel into a wobble,
> the wobble hammering the tire against the road in a repeating patch.
> Overlay: "That wobble hammers one spot of the tire, thousands of times a
> mile." CUT: a technician's balancing machine spins the wheel, a small weight
> clips onto the rim, the wobble smooths to a perfect spin. CLOSE: the
> steering wheel dead calm, coffee still. Overlay: "Smooth wheel. Longer tire
> life. Like getting a phone case that actually fits." No dialogue, no prices.

### 5. Engine Air Filter (`ENG-FLT` · every 30,000 miles)

> Vertical 9:16 video, 20 seconds, photorealistic macro with one clean 3D
> cutaway, bold text overlays. OPEN: slow-motion air rushing into a car's
> intake as it drives — visualized as a faint blue stream. Overlay: "Your
> engine breathes about 10,000 liters of air for every liter of fuel." CUT:
> hands hold two engine air filters side by side in daylight: one bright
> white pleated paper, one grey-brown, packed with dust, leaves, and debris.
> No caption needed for two seconds — let the comparison land. Overlay: "This
> is yours after 30,000 miles." CUT: 3D cutaway of an engine gasping through
> the clogged filter, the blue air stream thinning to a wheeze, the fuel
> gauge dropping faster. Overlay: "A choked engine burns more gas to do the
> same job." CLOSE: new filter dropping into place, the blue stream full
> again. Overlay: "Let it breathe." No people's faces, no dialogue, no prices.

### 6. Cabin Air Filter (`CAB-FLT` · every 30,000 miles)

> Vertical 9:16 video, 20 seconds, photorealistic macro, bold text overlays.
> OPEN: a person's hand turns the AC dial up; air flows from the dash vents,
> visualized as a soft clean stream toward a child in a car seat in the back.
> Overlay: "Every breath in your car comes through one filter." CUT: macro of
> a used cabin air filter being pulled from behind a glovebox — grey pleats
> matted with pollen, dust, and a leaf, against a bright white new one.
> Overlay: "Pollen, exhaust dust, everything the road throws at you — it all
> stops here. Until the filter is full." CUT: allergy-season street B-roll,
> pollen drifting visibly in sunlight. CLOSE: fresh filter sliding in, vent
> air stream bright and clear again. Overlay: "The one filter you're actually
> breathing through. Swap it like you'd swap a Brita." No dialogue, no prices.

### 7. Brake Fluid Exchange (`BRK-FLU` · every 45,000 miles)

> Vertical 9:16 video, 25 seconds, clean 3D cutaway style with photorealistic
> inserts, bold text overlays, calm tone — no alarm sounds or crash imagery.
> OPEN: 3D cutaway of a car showing the brake line as a glowing amber thread
> from pedal to all four wheels. A foot presses the pedal; pressure pulses
> down the thread; the car glides to a stop. Overlay: "Your brake pedal
> doesn't pull a cable. It pushes fluid." CUT: macro of two glass vials — new
> brake fluid, clear as honey, next to old fluid, dark like flat cola, with
> tiny water droplets visible inside. Overlay: "Brake fluid slowly absorbs
> water from the air. Water boils. Fluid shouldn't." CUT: the cutaway again
> on a long downhill: the old fluid's thread develops small vapor bubbles,
> and the pedal sinks visibly deeper before the car slows. Overlay: "Old
> fluid = a softer, longer pedal exactly when you're asking the most of it."
> CLOSE: fresh amber fluid flushing through the lines, pedal firm, short
> stop. Overlay: "Fresh fluid keeps the pedal honest." No dialogue, no prices.

### 8. Transmission Fluid Service (`TRANS-SVC` · every 60,000 miles)

> Vertical 9:16 video, 25 seconds, premium 3D cutaway animation, bold text
> overlays. OPEN: cutaway of an automatic transmission in motion — planetary
> gears meshing in slow motion, bathed in bright red fluid that cushions
> every contact. Overlay: "Your transmission shifts thousands of times per
> drive. This fluid is what it shifts through." CUT: time-lapse — the red
> fluid darkens to brown, fine metallic glitter accumulating in it; gear
> engagements get visibly harsher, tiny sparks of metal-on-metal contact.
> Overlay: "It wears out invisibly. You feel it late — a hesitation, a
> clunk." CUT: photorealistic insert of a drain plug's magnet furred with
> metal shavings. Overlay: "By then, this is what's in there." CLOSE: fresh
> red fluid cycling in, gears meshing silk-smooth again. Overlay: "A fluid
> service costs a fraction of the transmission it protects." No dialogue, no
> prices.

### 9. Coolant Flush (`COOL-FL` · every 100,000 miles)

> Vertical 9:16 video, 20 seconds, 3D cutaway with photorealistic macro
> inserts, bold text overlays. OPEN: cutaway of an engine glowing with heat,
> neon-green coolant streaming through channels around the cylinders,
> carrying the glow away to the radiator where it cools and cycles back.
> Overlay: "Your engine makes enough heat to destroy itself. Coolant carries
> it away — summer and winter." CUT: macro of two coolant samples: vivid
> green-orange and clean vs. murky rust-brown with sediment. Overlay: "Old
> coolant turns acidic and starts eating the metal it's meant to protect."
> CUT: the cutaway again — rusty coolant leaving crusty deposits that narrow
> a channel, the engine's glow creeping hotter, the temperature needle
> climbing. CLOSE: fresh coolant flushing the system bright again, needle
> settling to center. Overlay: "It's not just water. It's what keeps
> 200 degrees on the right side of the metal." No dialogue, no prices.

### 10. Power Steering Fluid Exchange (`PS-FLU` · every 60,000 miles · 2012 and older)

> Vertical 9:16 video, 20 seconds, photorealistic with one 3D cutaway, bold
> text overlays. OPEN: close on hands turning a steering wheel one-finger-
> easy into a parking spot. Overlay: "On cars built before ~2012, steering
> this easy is hydraulic — a pump, pushing fluid." CUT: 3D cutaway of the
> steering rack, amber fluid pressurizing left and right as the wheel turns.
> CUT: macro comparison — clear amber fluid vs. fluid gone dark and thin;
> audio-free visual of a pump straining, the assist stuttering; the wheel
> now needs two hands and real effort at parking speed, with a subtle
> steering-wheel shudder. Overlay: "Old fluid starves the pump. First it
> whines. Then it quits — usually in a parking lot." CLOSE: fresh amber
> fluid, the wheel gliding again. Overlay: "Keep the easy in easy steering."
> No dialogue, no prices.

### 11. Differential Fluid Service (`DIFF-SVC` · every 45,000 miles · RWD/AWD/4WD)

> Vertical 9:16 video, 20 seconds, clean 3D animation, bold text overlays.
> OPEN: a car rounding a corner, viewed from above, ghosted — the outside
> wheels visibly travel a longer arc than the inside wheels. Overlay: "In
> every turn, your outside wheels travel farther than your inside wheels."
> CUT: cutaway of the differential — the gear set that lets the wheels spin
> at different speeds — heavy spiral gears meshing under load, coated in
> thick golden oil. Overlay: "One gearbox makes that possible. It carries
> the full twist of the engine." CUT: time-lapse of the oil darkening and
> thinning, gear teeth starting to glint dry at the contact point, a faint
> whine visualized as vibration lines. Overlay: "The oil breaks down long
> before the gears complain out loud." CLOSE: fresh golden oil flooding the
> housing, teeth cushioned again. Overlay: "Cheap oil change. Very not-cheap
> gearbox." No dialogue, no prices.

### 12. Transfer Case Fluid Service (`TCASE-SVC` · every 45,000 miles · AWD/4WD)

> Vertical 9:16 video, 20 seconds, clean 3D animation, bold text overlays.
> OPEN: an SUV on a wet on-ramp, viewed ghosted from above; power visibly
> flows from the engine and splits at a small gearbox in the middle of the
> car, streaming to both front and rear axles as glowing lines; the car
> grips and pulls through the wet without drama. Overlay: "All-wheel drive
> means one small gearbox splits the power to all four wheels." CUT: cutaway
> of the transfer case — chain and gears running in fluid. Overlay: "It only
> works as well as the fluid inside it." CUT: the fluid dark and gritty; the
> chain jerks against its gears; the power split hesitates a beat before the
> front wheels get their share on the next wet launch. Overlay: "Worn fluid
> makes your all-wheel drive show up late." CLOSE: fresh fluid, instant
> smooth split, all four glow lines lit. Overlay: "Feed the box that feeds
> all four wheels." No dialogue, no prices.

### 13. Fuel System Induction Service (`IND-SVC` · every 30,000 miles)

> Vertical 9:16 video, 20 seconds, photorealistic borescope-style macro with
> a 3D cutaway, bold text overlays. OPEN: inside an engine's intake valve
> area, filmed like an inspection camera: black, crusty carbon deposits
> caked on the valves like burnt toast crumbs. Overlay: "Every tank of gas
> leaves a little residue behind. This is 30,000 miles of it." CUT: 3D
> cutaway showing the air-fuel mist tumbling into the cylinder around a
> crusted valve — the mist swirls unevenly, the burn flickers ragged; a
> fuel gauge ticks down faster and the idle stumbles. Overlay: "Buildup
> makes the burn sloppy — rough idle, lazy throttle, more gas for the same
> miles." CUT: cleaning solution fogging through, deposits dissolving and
> flaking away in the borescope view. CLOSE: valves metal-clean, the burn
> even and blue, idle steady. Overlay: "Like descaling a kettle — but for
> the thing you drive every day." No dialogue, no prices.

### 14. PCV Valve Replacement (`PCV` · every 60,000 miles)

> Vertical 9:16 video, 20 seconds, clean 3D cutaway animation, bold text
> overlays. OPEN: cutaway of a running engine, tiny wisps of combustion gas
> slipping past the pistons into the crankcase below, pressure visibly
> building like a shaken bottle. Overlay: "Every engine leaks a little
> pressure into its own crankcase. That's normal." CUT: a small one-way
> valve — the PCV valve, the size of a thumb — venting that pressure back to
> be re-burned, a neat little relief loop. Overlay: "One tiny valve vents
> it safely. It costs less than a pizza." CUT: the valve gummed shut with
> sludge; pressure builds; oil gets forced out past gaskets — a drip forms
> under the engine, and sludge spreads through the oil passages. Overlay:
> "When it sticks, the pressure finds another way out — through your
> gaskets." CLOSE: new valve clicked in, the loop flowing, no drip.
> Overlay: "Smallest part on the menu. Guards the most expensive one." No
> dialogue, no prices.

### 15. Serpentine Belt Replacement (`BELT` · every 90,000 miles)

> Vertical 9:16 video, 25 seconds, photorealistic with a 3D route
> visualization, bold text overlays, calm tone. OPEN: macro of a single
> ribbed rubber belt snaking through an engine bay, wrapping pulley after
> pulley, everything spinning in sync. Overlay: "One belt runs almost
> everything: your alternator, your AC, your power steering, your water
> pump." CUT: 3D route map lighting up each system the belt drives, like a
> subway map with one line serving every station. Overlay: "One line. No
> backup." CUT: macro of an aging belt — glazing, fine cracks across the
> ribs like a worn phone case, a small chunk missing. Time-lapse of the
> cracks deepening. Overlay: "Rubber doesn't warn you twice." CUT: the belt
> lets go: every station on the map goes dark at once; a car coasts to the
> shoulder, hazards on, hood up — daytime, calm, no drama. Overlay: "When
> it goes, everything goes. Wherever you are." CLOSE: fresh belt threaded
> on, the whole map lit. Overlay: "Ninety thousand miles is a good life.
> Don't ask for two." No dialogue, no prices.

### 16. Spark Plug Replacement (`PLUGS` · every 100,000 miles)

> Vertical 9:16 video, 20 seconds, macro photorealistic with slow-motion 3D
> combustion, bold text overlays. OPEN: extreme slow motion inside a
> cylinder: a spark plug fires a crisp blue-white arc, igniting the fuel
> mist in a perfect expanding orange bloom. Overlay: "This happens about
> 1,000 times a minute while you drive." CUT: macro comparison of two
> plugs: new — clean electrode, sharp edges — and 100,000 miles old —
> rounded, crusted, gap widened. Overlay: "Every spark wears the tip. A
> worn plug fires weak — or misses." CUT: the worn plug in slow motion:
> the arc sputters, the bloom is partial and ragged; the car's tach
> stumbles, fuel gauge ticks faster. Overlay: "Misfires waste gas and beat
> up the engine downstream." CLOSE: new plugs seated, four crisp blooms in
> rhythm like pistons firing in a drumline. Overlay: "A hundred thousand
> miles on the originals is the deal. Take it." No dialogue, no prices.

---

## The 3 measurement-driven services

These are never offered on a schedule — the engine recommends them only when
this vehicle's own inspection numbers say so, and the menu shows the actual
measurement beside the price. The prompts lean into that: the video's job is
to make the *number on their menu* mean something.

### 17. Tire Replacement (`TIRE4` · recommended from tread measurement)

> Vertical 9:16 video, 25 seconds, photorealistic slow motion, bold text
> overlays, serious but calm — no crash imagery. OPEN: extreme macro of a
> tire rolling through standing water in slow motion: deep tread channels
> visibly pumping water out sideways in sheets. Overlay: "Tread isn't for
> dry roads. It's a water pump — gallons per second." CUT: split screen,
> same wet road, same speed: a tire at 8/32" grips through; a tire at 2/32"
> rides up on the water film, contact patch visibly floating. Overlay:
> "Below about 4/32", the pump can't keep up. Braking distance in rain
> grows by car lengths." CUT: macro of a tread-depth gauge pressed into a
> groove, the needle showing the measurement — mirror the menu: "Your
> technician measured YOUR tires today. That number on your menu is this
> gauge." CLOSE: new tire biting into wet pavement, water sheeting away.
> Overlay: "The only part of your car that touches the road." No dialogue,
> no prices.

### 18. Front Brake Pads & Rotors (`BRK-FR` · recommended from pad measurement)

> Vertical 9:16 video, 25 seconds, photorealistic macro plus one clean 3D
> cutaway, bold text overlays, serious but calm — no crash or near-miss
> footage. OPEN: slow-motion cutaway of a brake caliper squeezing pads
> against a spinning rotor, heat shimmer rising, the car easing to a stop.
> Overlay: "Every stop shaves a little off these pads. That's their job."
> CUT: macro ruler shot — a new pad at 10mm thick next to a worn pad at
> 3mm, filmed like a phone-battery-health comparison. Overlay: "Your
> technician measured YOURS in millimeters today — that's the number on
> your menu." CUT: the 3D cutaway again with the thin pad: metal backing
> nearly touching the rotor, stopping distance stretching visibly on a
> simple overhead diagram — one car stops at a line, the other slides
> past it. Overlay: "Thin pads stop later. Then they stop metal-on-metal,
> and the rotor bill joins the pad bill." CLOSE: fresh pads seated, crisp
> confident stop at the line. Overlay: "Brakes don't fail loudly first.
> They fade quietly first." No dialogue, no prices.

### 19. Four-Wheel Alignment (`ALIGN` · recommended from uneven wear evidence)

> Vertical 9:16 video, 20 seconds, clean 3D visualization with one
> photorealistic macro, bold text overlays. OPEN: a car ghosted from above
> driving a straight line — but one front wheel is toed a fraction of a
> degree off, visualized with an exaggerated angle line. The car tracks
> straight because the other wheels quietly fight the crooked one. Overlay:
> "Your car can drive perfectly straight while one wheel points slightly
> wrong. The others just fight it — all day." CUT: macro of the price of
> that fight: one tire's inside shoulder scrubbed bald while the rest of
> the tread looks fine — mirror the menu: "That's why the tread on YOUR
> menu reads uneven across the axle. Nobody's guessing — it's measured."
> CUT: alignment rack visual: laser targets on each wheel, the angle line
> easing back to true. CLOSE: overhead view, all four wheels tracking in
> harmony, tire wear even in time-lapse. Overlay: "An alignment costs a
> fraction of the tires it saves." No dialogue, no prices.

---

## Not on this list, on purpose

- **Recalls, resurfaced declined services, and prepaid-maintenance
  redemptions** also reach the customer menu, but none is "a service" with
  one explainer — a recall is the manufacturer's letter, a resurfaced
  decline is one of the above wearing an older date, and a prepaid
  redemption is one of the above already paid for.
- **Advisor-only items** (warranty-expiring, protection-product upsells)
  never reach the customer menu, so they get no customer video.
- The engine's interval list is extensible per store
  (`PrepSheetInput.maintenanceIntervals`); a store that adds services will
  need prompts written in this file's voice — the rules at the top are the
  template.

# Service Explainer Animations — Grok Imagine Prompts (Basic Animation Set)

**What this is:** the companion set to `SERVICE_VIDEO_PROMPTS.md` — the same
19 customer-menu services, re-prompted for **simple 2D animation** instead of
photorealistic video. One self-contained prompt per service; paste a block
into Grok Imagine as-is.

**Why a second set:** flat animation explains *mechanisms* better than film —
a cutaway that would need CGI in live action is three shapes and an arrow in
2D — and it renders more reliably, ages better, and can't look like a stock
clip from someone else's dealership. It is also the style closest to the 20
animated explainers already inside the app (`src/lib/explainer/`), so if
these ever surface in the `ExplainerPlayer`, they'll read as one family.

**The shared style, written into every prompt (hold it in any edit):**
flat 2D vector animation, simple geometric shapes, thick clean outlines,
a limited friendly palette (one accent color for the part that matters,
neutral greys for everything else), smooth eased motion, no photorealism,
no faces with detail, vertical 9:16, 15–30 seconds, large text labels doing
the explaining — plays muted on a tablet in a bright service drive.

**The voice rules are the same as the first set:** show the part, consequence
not fear, no jargon in labels, analogies from a 25-year-old's life, and
**no prices, no brands, no dealership names** — a price baked into a video is
a quote nobody can stand behind.

---

## The 16 scheduled maintenance intervals

### 1. Oil & Filter Change (`LOF`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes with
> thick outlines, one amber accent color, large text labels, no sound needed.
> OPEN: a simple side-view engine drawn as a rounded box with three pistons
> pumping; golden droplets circulate through it in a smooth loop. Label: "Oil
> keeps every moving part from grinding." SCENE 2: the droplets gradually
> darken to black and slow down; tiny grit specks join the flow; the pistons'
> motion turns jerky with small friction sparks drawn as simple star shapes.
> Label: "Old oil turns gritty — and grit sands your engine down." SCENE 3: a
> funnel pours fresh golden droplets in while a simple pleated-filter icon
> catches the specks. Label: "New oil + new filter = a clean loop." CLOSE:
> pistons pumping smoothly again, a small happy motion flourish. Label:
> "Cheapest thing you'll ever do for your engine."

### 2. Tire Rotation (`ROT`)

> Flat 2D vector animation, vertical 9:16, 15 seconds, simple shapes, one
> teal accent, large labels, no sound. OPEN: a top-down car outline with four
> tire circles; the front two visibly shrink in a time-lapse (wear drawn as
> the circle thinning) while the rears stay thick. Label: "Front tires do the
> steering, braking and carrying — they wear first." SCENE 2: curved arrows
> swap front and rear circles in one smooth choreographed move. Label:
> "Rotating shares the work." CLOSE: split screen — the rotated set of four
> thins evenly and lasts; the unrotated set has two circles wear to nothing
> early. Label: "Same tires. Thousands of miles more."

### 3. Wiper Blade Replacement (`WIPER`)

> Flat 2D vector animation, vertical 9:16, 15 seconds, simple shapes, one
> blue accent, large labels, no sound. OPEN: a windshield rectangle in rain
> (rain as simple diagonal dashes); a wiper arm sweeps but leaves grey smear
> arcs behind it; a simple oncoming-headlight glow blooms through the smear.
> Label: "Wiper rubber bakes all summer. You find out in one night of rain."
> SCENE 2: zoom to the blade edge drawn as a cracked, wavy line against the
> glass. Label: "Cracked rubber can't seal against the glass." CLOSE: a new
> blade snaps on (satisfying click motion), one sweep wipes the rectangle
> perfectly clear, rain dashes bounce off. Label: "Two minutes. Whole
> windshield back."

### 4. Tire Balance (`BAL`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> purple accent, large labels, no sound. OPEN: a wheel circle spinning on an
> axle; a small heavy dot sits on one edge, dragging the spin into a visible
> wobble — motion lines exaggerate the shake, and a steering-wheel icon above
> vibrates with fuzz lines. Label: "A few grams off-center becomes a buzz at
> highway speed." SCENE 2: the wobbling wheel hammers one patch of its edge
> flat, drawn as a repeated impact flash on the same spot. Label: "The wobble
> pounds one spot of the tire, mile after mile." SCENE 3: a small
> counterweight dot clips onto the opposite edge; the spin smooths into a
> perfect circle with clean motion lines. CLOSE: the steering-wheel icon dead
> still. Label: "Balanced wheel. Calm wheel. Longer-lasting tire."

### 5. Engine Air Filter (`ENG-FLT`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> green accent, large labels, no sound. OPEN: an engine box breathing —
> a wide arrow of air flows in through a clean pleated-filter icon, and the
> engine's "power meter" bar sits full. Label: "Your engine breathes 10,000
> liters of air per liter of gas." SCENE 2: dust specks accumulate on the
> filter in time-lapse until it's drawn solid grey; the air arrow thins to a
> narrow squiggle; the power bar drops and a fuel-pump icon ticks faster.
> Label: "A clogged filter chokes the engine — more gas, less go." CLOSE: a
> fresh white filter slides in, the arrow widens, the bar refills. Label:
> "Let it breathe."

### 6. Cabin Air Filter (`CAB-FLT`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> soft-blue accent, large labels, no sound. OPEN: a simple car cabin
> cross-section with two round-headed figures; air flows from outside through
> a filter icon into the cabin as a clean blue stream toward them. Label:
> "Every breath in your car passes through one filter." SCENE 2: outside the
> car, pollen dots, dust specks and exhaust squiggles drift toward the
> intake; the filter catches them in time-lapse until it's drawn matted and
> grey; the cabin stream turns thin and dotted. Label: "Pollen, dust,
> exhaust — it all stops here. Until the filter is full." CLOSE: a fresh
> filter slots in with a click; the stream runs wide and clean again over
> the figures. Label: "The filter you're actually breathing through. Swap it
> like a water-pitcher filter."

### 7. Brake Fluid Exchange (`BRK-FLU`)

> Flat 2D vector animation, vertical 9:16, 25 seconds, simple shapes, one
> amber accent, large labels, no sound, calm pacing. OPEN: a side-view car
> outline; a foot presses a pedal icon and a pulse travels down an amber
> fluid line to all four wheels, which clamp and stop the car smoothly.
> Label: "Your brake pedal pushes fluid, not a cable." SCENE 2: tiny blue
> water droplets seep into the amber line over a time-lapse calendar; the
> fluid darkens. Label: "Brake fluid slowly soaks up water from the air."
> SCENE 3: a long downhill drawn as a slope; the dark fluid forms small
> bubbles; the pedal icon sinks visibly deeper before the wheels clamp, and
> the stop line lands farther away. Label: "Water boils under hard braking.
> Bubbles squish — fluid shouldn't." CLOSE: fresh amber fluid flushes the
> loop, pedal firm, short crisp stop. Label: "Fresh fluid keeps the pedal
> honest."

### 8. Transmission Fluid Service (`TRANS-SVC`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> red accent, large labels, no sound. OPEN: two interlocking gear circles
> turning smoothly inside a rounded gearbox, bathed in red fluid drawn as a
> soft wash; each gear engagement is cushioned with a little "soft bounce"
> motion. Label: "Your transmission shifts thousands of times a drive — this
> fluid cushions every one." SCENE 2: the wash darkens to brown with glitter
> specks (metal dust); engagements turn sharp and clacky, drawn with hard
> impact flashes. Label: "It wears out invisibly. You feel it late." SCENE 3:
> a magnet icon at the bottom collects a fuzzy pile of specks. Label: "By
> then, this is what's inside." CLOSE: fresh red wash cycles in, gears turn
> soft and smooth. Label: "A fluid service costs a fraction of a
> transmission."

### 9. Coolant Flush (`COOL-FL`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> green accent plus a red heat glow, large labels, no sound. OPEN: an engine
> box glowing red at its core; green droplets loop through it, each one
> picking up the glow, carrying it to a radiator grille icon, cooling to
> green, and looping back. Label: "Your engine makes enough heat to cook
> itself. Coolant hauls it away." SCENE 2: the green droplets age to murky
> brown; rust flakes build crusty deposits that narrow the channel; fewer
> droplets get through; the red glow spreads and a temperature gauge icon
> climbs. Label: "Old coolant turns acidic and clogs its own pipes." CLOSE:
> a flush sweeps the crust out, bright green droplets flood the loop, the
> gauge settles to center. Label: "It's not just water — it's what keeps the
> heat on the right side of the metal."

### 10. Power Steering Fluid Exchange (`PS-FLU` · 2012 and older)

> Flat 2D vector animation, vertical 9:16, 15 seconds, simple shapes, one
> orange accent, large labels, no sound. OPEN: a steering wheel icon turned
> by one finger; below it, a small pump circle pushes orange fluid to a rack
> that nudges the wheels — effort meter reads "easy". Label: "On cars before
> ~2012, easy steering is a pump pushing fluid." SCENE 2: the fluid darkens
> and thins; the pump strains with shake lines and a whine squiggle; the
> effort meter climbs and the wheel now needs two hands, drawn straining.
> Label: "Old fluid starves the pump. First it whines. Then it quits."
> CLOSE: fresh orange fluid, the pump spins smooth, one finger turns the
> wheel again. Label: "Keep the easy in easy steering."

### 11. Differential Fluid Service (`DIFF-SVC` · RWD/AWD/4WD)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> gold accent, large labels, no sound. OPEN: a top-down car outline rounding
> a curve; dotted arc paths show the outside wheels traveling a visibly
> longer line than the inside wheels. Label: "In every turn, your outside
> wheels travel farther than the inside ones." SCENE 2: zoom to a small
> gearbox between the rear wheels — two gear circles turning at different
> speeds, coated in a gold wash. Label: "One gearbox makes that possible.
> It carries the engine's full twist." SCENE 3: the wash thins and darkens;
> gear teeth touch dry with grind flashes and a wobble squiggle. Label: "The
> oil gives up long before the gears complain out loud." CLOSE: fresh gold
> wash floods in, teeth cushioned, smooth turning. Label: "Cheap oil change.
> Very not-cheap gearbox."

### 12. Transfer Case Fluid Service (`TCASE-SVC` · AWD/4WD)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> blue accent, large labels, no sound. OPEN: a top-down SUV outline on a
> rain-dashed road; power flows from the engine as a glowing line that
> splits at a small box in the middle, streaming to both axles; all four
> wheels grip with little traction ticks. Label: "All-wheel drive = one
> small gearbox splitting power to all four wheels." SCENE 2: inside the
> box, a chain loop runs over two gears in fluid; the fluid darkens, the
> chain jerks with a skip flash, and on the next wet launch the front
> wheels' glow line lights a beat late — the car's nose wiggles. Label:
> "Worn fluid makes your all-wheel drive show up late." CLOSE: fresh fluid,
> the split fires instantly, all four glow lines lit together, straight
> confident launch. Label: "Feed the box that feeds all four wheels."

### 13. Fuel System Induction Service (`IND-SVC`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> orange accent, large labels, no sound. OPEN: a cylinder cross-section; a
> fine fuel-air mist (small dots) swirls in past a valve and burns in a
> neat round orange bloom; an idle meter holds steady. Label: "A clean burn
> starts with a clean path in." SCENE 2: dark crumb shapes build up on the
> valve in time-lapse, like burnt toast crumbs; the mist tumbles unevenly
> around them; the bloom turns ragged and lopsided; the idle meter stutters
> and a fuel-pump icon ticks faster. Label: "Every tank leaves residue.
> 30,000 miles of it makes the burn sloppy." SCENE 3: cleaning fog sweeps
> through, crumbs dissolve and flake away. CLOSE: clean valve, round even
> bloom, steady meter. Label: "Like descaling a kettle — for the thing you
> drive every day."

### 14. PCV Valve Replacement (`PCV`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> teal accent, large labels, no sound. OPEN: an engine box; tiny puffs slip
> past the pistons into the crankcase below, drawn as pressure dots slowly
> filling the space like a shaken soda bottle. Label: "Every engine leaks a
> little pressure into its own basement. Normal." SCENE 2: a thumb-sized
> one-way valve on top vents the dots back up in a tidy loop to be re-burned.
> Label: "One tiny valve vents it safely." SCENE 3: the valve gums shut
> (drawn clogged, stuck flap); dots crowd, pressure builds, and oil drips
> squeeze out past the box's seams — a drip puddle forms underneath. Label:
> "When it sticks, pressure escapes through your gaskets instead." CLOSE:
> new valve clicks in, the loop flows, the drip stops. Label: "Smallest part
> on the menu. Guards the biggest bill."

### 15. Serpentine Belt Replacement (`BELT`)

> Flat 2D vector animation, vertical 9:16, 25 seconds, simple shapes, one
> red accent, large labels, no sound, calm pacing. OPEN: one long belt line
> snaking around five labeled pulleys — ALTERNATOR, A/C, STEERING, WATER
> PUMP — all spinning together like a subway map with one line through every
> station. Label: "One belt runs almost everything. One line. No backup."
> SCENE 2: zoom to the belt surface: small cracks appear across it in
> time-lapse, drawn like cracks in a phone case, then a notch chips out.
> Label: "Rubber doesn't warn you twice." SCENE 3: the belt snaps (a clean
> "boing" motion, no drama); every station's light blinks off at once; the
> little car coasts to the roadside with hazard-triangle icon — daytime,
> calm. Label: "When it goes, everything goes. Wherever you are." CLOSE: a
> fresh belt threads the map, every station lights back up in sequence.
> Label: "90,000 miles is a good life. Don't ask for two."

### 16. Spark Plug Replacement (`PLUGS`)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> electric-blue accent, large labels, no sound. OPEN: a spark plug icon
> fires a crisp zigzag spark; a round orange bloom ignites in rhythm — four
> plugs firing in a drumline pattern, a tach needle steady. Label: "This
> happens about 1,000 times a minute." SCENE 2: side-by-side plugs: new —
> sharp clean tip — and old — rounded, crusted, the gap drawn visibly wider.
> The old one's spark sputters into a weak squiggle; one bloom in the
> drumline misses; the tach needle stumbles and the fuel icon ticks faster.
> Label: "Worn tips fire weak — or miss. Misfires waste gas and beat up the
> engine." CLOSE: four new plugs, four crisp sparks, four round blooms in
> perfect rhythm. Label: "100,000 miles on one set is the deal. Take it."

---

## The 3 measurement-driven services

Same rule as the first set: these prompts point at the number on the
customer's own menu, because the measurement is the argument.

### 17. Tire Replacement (`TIRE4` · from tread measurement)

> Flat 2D vector animation, vertical 9:16, 25 seconds, simple shapes, one
> blue accent, large labels, no sound, serious but calm. OPEN: a tire
> cross-section rolling over a wet road strip; deep tread grooves channel
> blue water dashes out to the sides in visible jets. Label: "Tread is a
> water pump — gallons per second." SCENE 2: split screen at the same speed:
> a deep-groove tire keeps a full contact patch on the road; a worn shallow
> tire rides up on a thin blue film, its contact patch shrinking, and its
> stop line lands car-lengths later — drawn as two simple stop bars. Label:
> "Worn tread can't pump. Rain braking gets car-lengths longer." SCENE 3: a
> tread-depth gauge icon presses into the groove and reads out a number.
> Label: "Your technician measured YOUR tires today — that's the number on
> your menu." CLOSE: new tire, jets flying, full patch planted. Label: "The
> only part of your car that touches the road."

### 18. Front Brake Pads & Rotors (`BRK-FR` · from pad measurement)

> Flat 2D vector animation, vertical 9:16, 25 seconds, simple shapes, one
> red accent, large labels, no sound, serious but calm. OPEN: a wheel circle
> with a caliper clamping two pad blocks onto a spinning disc; the car
> glides to a stop at a line; small heat ticks rise off the disc. Label:
> "Every stop shaves a little off these pads. That's the job." SCENE 2: a
> ruler graphic beside two pad blocks: NEW at 10mm tall, WORN at 3mm — drawn
> exactly like a battery-health bar draining. Label: "Yours were measured in
> millimeters today — that's the number on your menu." SCENE 3: the thin pad
> clamps; the stop arrow stretches past the line; then the pad wears through
> and metal touches metal with grind sparks, the disc scoring with jagged
> lines. Label: "Thin pads stop later. Bare metal stops on your rotor —
> and adds it to the bill." CLOSE: fresh 10mm pads clamp, crisp stop dead on
> the line. Label: "Brakes fade quietly before they ever fail loudly."

### 19. Four-Wheel Alignment (`ALIGN` · from uneven wear evidence)

> Flat 2D vector animation, vertical 9:16, 20 seconds, simple shapes, one
> green accent, large labels, no sound. OPEN: a top-down car outline driving
> a straight dashed line; three wheels point true, one is drawn angled a few
> exaggerated degrees off; small opposing-force arrows show the other wheels
> quietly fighting it while the car still tracks straight. Label: "Your car
> can drive perfectly straight while one wheel points slightly wrong." SCENE
> 2: zoom to that wheel's tire strip: one shoulder of the tread scrubs away
> in time-lapse while the rest stays thick — an uneven wear bar chart grows
> beside it. Label: "The fight scrubs one edge of the tire bald. That's the
> uneven wear on YOUR menu — measured, not guessed." SCENE 3: laser lines
> from an alignment rack icon sweep each wheel; the angled wheel eases back
> to true. CLOSE: all four arrows in harmony down the dashed line, the wear
> chart evening out. Label: "An alignment costs a fraction of the tires it
> saves."

---

## Choosing between the two sets

- **This set (flat animation):** better for *mechanism* — cutaways, flows,
  pressure, before/after states; consistent with the in-app explainers;
  renders predictably.
- **The first set (photorealistic):** better for *recognition* — a real worn
  filter next to a new one lands viscerally in a way a diagram can't.
- The strongest program is probably: this set as the default explainer
  family, with the photorealistic set's comparison shots (filters, plugs,
  pads, wipers) as inserts where seeing the real part is the argument.

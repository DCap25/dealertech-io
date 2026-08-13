import { describe, it, expect } from 'vitest'
import { COMPONENT_GROUPS, getComponentGroup, componentGroupsBySystem } from './component-groups'
import { SYSTEMS } from './systems'
import { resolveComponentGroup, resolveComponentGroups, normalize } from './resolve'

describe('component group data integrity', () => {
  it('has no duplicate keys', () => {
    const keys = COMPONENT_GROUPS.map((g) => g.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has no alias claimed by two different groups', () => {
    const owner = new Map<string, string>()
    const collisions: string[] = []
    for (const g of COMPONENT_GROUPS) {
      for (const alias of g.aliases) {
        const normalized = normalize(alias)
        const existing = owner.get(normalized)
        if (existing && existing !== g.key) {
          collisions.push(`"${alias}" claimed by both ${existing} and ${g.key}`)
        }
        owner.set(normalized, g.key)
      }
    }
    expect(collisions).toEqual([])
  })

  it('assigns every group to a known system', () => {
    for (const g of COMPONENT_GROUPS) {
      expect(SYSTEMS).toContain(g.system)
    }
  })

  it('populates every system with at least one group', () => {
    for (const system of SYSTEMS) {
      expect(componentGroupsBySystem(system).length).toBeGreaterThan(0)
    }
  })

  it('restricts the federal 8yr/80k emissions term to the three statutory components', () => {
    // Clean Air Act: catalytic converter, emissions control unit (ECM/PCM), and
    // the onboard diagnostic device. Widening this list would have us telling
    // advisors a repair is free when it is not.
    const longTerm = COMPONENT_GROUPS.filter((g) => g.emissionsFederalLong).map((g) => g.key)
    expect(longTerm.sort()).toEqual(['CATALYTIC_CONVERTER', 'ECM_PCM', 'OBD_MODULE'])
  })

  it('never marks a wear item as powertrain-eligible', () => {
    const contradictions = COMPONENT_GROUPS.filter((g) => g.wearItem && g.powertrainEligible)
    expect(contradictions.map((g) => g.key)).toEqual([])
  })

  it('documents the reason whenever coverage varies', () => {
    // A varying flag without an explanation is useless to an advisor on the phone.
    const undocumented = COMPONENT_GROUPS.filter(
      (g) => g.coverageVaries && !g.coverageNote,
    ).map((g) => g.key)
    // Not all variance needs prose, but the high-dollar ones do.
    const mustExplain = ['WATER_PUMP', 'AIR_SUSPENSION', 'CLUTCH_ASSEMBLY', 'TURBO_SUPERCHARGER']
    for (const key of mustExplain) {
      expect(undocumented).not.toContain(key)
    }
  })

  it('looks up by key', () => {
    expect(getComponentGroup('CATALYTIC_CONVERTER')?.label).toBe('Catalytic Converter')
    expect(getComponentGroup('NOPE')).toBeUndefined()
  })
})

describe('resolving free text to component groups', () => {
  it('resolves a DMS op-code description', () => {
    expect(resolveComponentGroup('LOF - LUBE OIL FILTER')?.group.key).toBe('OIL_CHANGE')
  })

  it("resolves a customer's own words", () => {
    expect(resolveComponentGroup('it makes a grinding noise when I brake')?.group.key).toBe(
      'BRAKE_PADS_SHOES',
    )
  })

  it('prefers the specific service over the general system', () => {
    // "brake fluid flush" must not land on brake pads just because both say "brake".
    expect(resolveComponentGroup('brake fluid flush')?.group.key).toBe('BRAKE_FLUID_SERVICE')
  })

  it('resolves a diagnostic trouble code', () => {
    expect(resolveComponentGroup('P0420 check engine light on')?.group.key).toBe(
      'CATALYTIC_CONVERTER',
    )
  })

  it('resolves hybrid concerns to the HV battery', () => {
    expect(resolveComponentGroup('customer states reduced range on hybrid battery')?.group.key).toBe(
      'HV_BATTERY_PACK',
    )
  })

  it('handles singular and plural interchangeably', () => {
    expect(resolveComponentGroup('replace tire')?.group.key).toBe('TIRES')
    expect(resolveComponentGroup('replace tires')?.group.key).toBe('TIRES')
    expect(resolveComponentGroup('spark plug replacement')?.group.key).toBe('SPARK_PLUGS')
  })

  it('does not match an alias embedded inside a longer word', () => {
    // "cat" must not fire inside "indicated"; "abs" must not fire inside "absorb".
    const keys = resolveComponentGroups('customer indicated the issue').map((r) => r.group.key)
    expect(keys).not.toContain('CATALYTIC_CONVERTER')
  })

  it('returns nothing for text with no automotive meaning', () => {
    expect(resolveComponentGroups('zzzz qqqq wwww')).toEqual([])
    expect(resolveComponentGroup('')).toBeUndefined()
  })

  it('reports high confidence on an unambiguous multi-word match', () => {
    const result = resolveComponentGroup('catalytic converter replacement')
    expect(result?.group.key).toBe('CATALYTIC_CONVERTER')
    expect(result?.confidence).toBe('HIGH')
  })

  it('flags the alternator as electrical, not powertrain', () => {
    // The single most commonly misrouted component in the drive.
    const result = resolveComponentGroup('alternator not charging')
    expect(result?.group.key).toBe('ALTERNATOR')
    expect(result?.group.powertrainEligible).toBe(false)
    expect(result?.group.system).toBe('ELECTRICAL')
  })
})

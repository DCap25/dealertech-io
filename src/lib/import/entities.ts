/**
 * What a dealership can bring with them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * A brand-new tenant has no history, and the opportunity engine reasons almost
 * entirely from history. Without an import, a store's first prep sheets say
 * "no record on file" against most lines — the engines degrade honestly, which
 * was deliberate, but honest-and-empty does not win a pilot. `docs/PLAN.md`
 * calls cold start critical path and it is right to.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER THESE ARE LISTED IN IS THE ORDER TO IMPORT THEM
 * ---------------------------------------------------------------------------
 * Declined services first, deliberately, even though vehicles are the spine.
 * A decline import can create the vehicles it needs as it goes, and it is the
 * one that makes a dealer principal sit up: it turns a five-year export into
 * "here is the work your store quoted and never followed up on", with a number
 * on it. Everything else improves the sheet; this one sells the product.
 *
 * Pure data. The coercion lives in ./coerce, the matching in ./mapping.
 */

import type { Coerced } from './coerce'
import {
  coerceDate, coerceEmail, coerceMileage, coerceMoney, coercePhone, coerceText, coerceVin,
} from './coerce'

export type ImportEntity = 'DECLINED_SERVICE' | 'VEHICLE' | 'SERVICE_HISTORY'

export type FieldType =
  | 'text' | 'vin' | 'date' | 'pastDate' | 'money' | 'mileage'
  | 'integer' | 'email' | 'phone'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  /** A row missing this is rejected. Everything else is merely absent. */
  required: boolean
  /**
   * Header names seen in real exports.
   *
   * Compared after stripping case and punctuation, so `RO #`, `ro_number` and
   * `RONumber` all match the same alias. Worth being generous: every alias
   * that lands is a column somebody does not have to map by hand, and the
   * mapping screen is where an import gets abandoned.
   */
  aliases: string[]
  hint?: string
}

export interface EntityDef {
  key: ImportEntity
  label: string
  /** Shown on the picker. Says what it is worth, not what it contains. */
  description: string
  fields: FieldDef[]
}

/** Shared across entities — the same customer columns appear in every export. */
const CUSTOMER_FIELDS: FieldDef[] = [
  {
    key: 'customerName', label: 'Customer name', type: 'text', required: false,
    aliases: ['customer', 'customername', 'name', 'ownername', 'owner', 'lastname', 'customerfullname'],
    hint: 'Used to create the customer if we have not seen them before.',
  },
  {
    key: 'customerEmail', label: 'Customer email', type: 'email', required: false,
    aliases: ['email', 'customeremail', 'emailaddress', 'owneremail'],
  },
  {
    key: 'customerPhone', label: 'Customer phone', type: 'phone', required: false,
    aliases: ['phone', 'customerphone', 'cellphone', 'mobile', 'homephone', 'phonenumber', 'contactphone'],
  },
]

const VIN_FIELD: FieldDef = {
  key: 'vin', label: 'VIN', type: 'vin', required: true,
  aliases: ['vin', 'vinnumber', 'vehiclevin', 'vinno', 'serialnumber', 'fullvin'],
  hint: 'The 17-character VIN. Every row is matched to a vehicle by this.',
}

export const ENTITIES: EntityDef[] = [
  {
    key: 'DECLINED_SERVICE',
    label: 'Declined services',
    description:
      'Work your store quoted and the customer said no to. The highest-value import — these become ranked opportunities on the first prep sheet, re-priced at today’s rates.',
    fields: [
      VIN_FIELD,
      {
        key: 'description', label: 'What was declined', type: 'text', required: true,
        aliases: ['description', 'opdescription', 'jobdescription', 'recommendation', 'declinedservice',
          'service', 'operation', 'complaint', 'linedescription', 'work'],
      },
      {
        key: 'quotedAmount', label: 'Amount quoted', type: 'money', required: true,
        aliases: ['amount', 'quotedamount', 'total', 'price', 'estimate', 'extendedprice',
          'saleamount', 'totalprice', 'quoted', 'linetotal'],
        hint: 'What it was quoted at then. It is re-priced before being re-offered.',
      },
      {
        key: 'declinedAt', label: 'Date declined', type: 'pastDate', required: true,
        aliases: ['date', 'declineddate', 'declinedon', 'rodate', 'closedate', 'transactiondate',
          'servicedate', 'visitdate'],
      },
      {
        key: 'mileageAtDecline', label: 'Mileage at the time', type: 'mileage', required: false,
        aliases: ['mileage', 'odometer', 'miles', 'odo', 'mileagein', 'odometerreading'],
        hint: 'Lets the sheet say how long the work has been outstanding in miles, not just months.',
      },
      {
        key: 'declineReason', label: 'Reason given', type: 'text', required: false,
        aliases: ['reason', 'declinereason', 'declinedreason', 'notes', 'comment'],
      },
      /*
        Vehicle identity, optional but wanted.

        A decline can only be stored against a vehicle, and `make` and
        `modelYear` are not nullable — so a row for a VIN we have never seen
        needs enough to create one. Most decline exports carry these already,
        because the advisor reading the report needs to know what the car is.

        Where they are absent and the VIN is unknown, the row is rejected with
        an instruction rather than imported against a vehicle called UNKNOWN.
        A prep sheet reading "2019 UNKNOWN" in front of a customer is worse
        than a row that did not import, and the warranty engine would have no
        reference data for it either.
      */
      {
        key: 'modelYear', label: 'Model year', type: 'integer', required: false,
        aliases: ['year', 'modelyear', 'vehicleyear', 'yr'],
        hint: 'Only needed for vehicles not already on file. Derived from the VIN when absent.',
      },
      {
        key: 'make', label: 'Make', type: 'text', required: false,
        aliases: ['make', 'manufacturer', 'brand', 'vehiclemake'],
        hint: 'Only needed for vehicles not already on file.',
      },
      {
        key: 'model', label: 'Model', type: 'text', required: false,
        aliases: ['model', 'vehiclemodel', 'carline', 'series'],
      },
      ...CUSTOMER_FIELDS,
    ],
  },
  {
    key: 'VEHICLE',
    label: 'Vehicles and customers',
    description:
      'Who owns what. Needed for coverage and warranty to mean anything — the warranty engine works from make, model year and in-service date.',
    fields: [
      VIN_FIELD,
      {
        key: 'modelYear', label: 'Model year', type: 'integer', required: true,
        aliases: ['year', 'modelyear', 'vehicleyear', 'yr'],
      },
      {
        key: 'make', label: 'Make', type: 'text', required: true,
        aliases: ['make', 'manufacturer', 'brand', 'vehiclemake'],
      },
      {
        key: 'model', label: 'Model', type: 'text', required: false,
        aliases: ['model', 'vehiclemodel', 'carline', 'series'],
      },
      {
        key: 'inServiceDate', label: 'In-service date', type: 'date', required: false,
        aliases: ['inservicedate', 'inservice', 'deliverydate', 'saledate', 'warrantystartdate',
          'purchasedate', 'firstusedate'],
        hint: 'When the factory warranty clock started. Without it, warranty is estimated from the model year.',
      },
      {
        key: 'currentMileage', label: 'Last known mileage', type: 'mileage', required: false,
        aliases: ['mileage', 'odometer', 'miles', 'currentmileage', 'lastmileage', 'odo'],
      },
      ...CUSTOMER_FIELDS,
    ],
  },
  {
    key: 'SERVICE_HISTORY',
    label: 'Service history',
    description:
      'Closed repair order lines. Tells the engine what has already been done, so it stops recommending an oil change performed last month — and gives every customer a visit count and lifetime spend.',
    fields: [
      VIN_FIELD,
      {
        key: 'closedAt', label: 'Date closed', type: 'pastDate', required: true,
        aliases: ['date', 'closedate', 'closeddate', 'rodate', 'invoicedate', 'transactiondate',
          'servicedate'],
      },
      {
        key: 'description', label: 'Work performed', type: 'text', required: true,
        aliases: ['description', 'opdescription', 'jobdescription', 'operation', 'service',
          'linedescription', 'work'],
      },
      {
        key: 'roNumber', label: 'RO number', type: 'text', required: false,
        aliases: ['ronumber', 'ro', 'ronum', 'repairorder', 'invoicenumber', 'invoice', 'ticket'],
        hint: 'Lines sharing an RO number are grouped into one visit.',
      },
      {
        key: 'opCode', label: 'Op code', type: 'text', required: false,
        aliases: ['opcode', 'operationcode', 'laborcode', 'code', 'jobcode'],
        hint: 'Maps the work to a component group, which is what stops a service being recommended twice.',
      },
      {
        key: 'amount', label: 'Amount', type: 'money', required: false,
        aliases: ['amount', 'total', 'price', 'extendedprice', 'saleamount', 'linetotal',
          'customerpay', 'totalprice'],
        hint: 'Adds up to the customer’s lifetime spend, which the engine weighs when judging goodwill.',
      },
      {
        key: 'mileage', label: 'Mileage', type: 'mileage', required: false,
        aliases: ['mileage', 'odometer', 'miles', 'odo', 'mileagein'],
      },
      ...CUSTOMER_FIELDS,
    ],
  },
]

export function entityDef(key: ImportEntity): EntityDef {
  const found = ENTITIES.find((e) => e.key === key)
  if (!found) throw new Error(`Unknown import entity "${key}"`)
  return found
}

/** Apply the coercion a field's type calls for. */
export function coerceField(
  field: FieldDef,
  raw: string,
  asOf: Date,
): Coerced<string | number | Date> {
  switch (field.type) {
    case 'vin': return coerceVin(raw)
    case 'date': return coerceDate(raw, { asOf })
    case 'pastDate': return coerceDate(raw, { notFuture: true, asOf })
    case 'money': return coerceMoney(raw)
    case 'mileage': return coerceMileage(raw)
    case 'email': return coerceEmail(raw)
    case 'phone': return coercePhone(raw)
    case 'integer': {
      const n = coerceMileage(raw)
      return n.ok ? { ok: true, value: n.value } : n
    }
    case 'text':
    default:
      return coerceText(raw)
  }
}
